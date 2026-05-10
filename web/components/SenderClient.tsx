"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { FileDropzone } from "@/components/FileDropzone";
import { ImageCropToA4Modal } from "@/components/ImageCropToA4Modal";
import { getPublicAppOrigin, getSignalingUrl } from "@/lib/config";
import { mimeForLocalFile } from "@/lib/mime";
import { DEFAULT_RTC_CONFIGURATION } from "@/lib/ice";
import { isValidSessionCode, SESSION_CODE_LENGTH } from "@/lib/sessionCode";
import {
  CHUNK_SIZE_BYTES,
  type ControlMessage,
  type FileStartMessage,
} from "@/lib/protocol";

type SignalingError = { code: string; message: string };

/** Open image crop overlay — owns an object URL revoked on discard or teardown. */
type CropSessionState = {
  objectUrl: string;
  originalFileName: string;
};

/** Pause sends while the browser buffers a large backlog. */
const DC_BUFFER_HIGH_WATER = 1024 * 1024;

async function waitForSendWindow(dc: RTCDataChannel): Promise<void> {
  while (dc.bufferedAmount > DC_BUFFER_HIGH_WATER) {
    await new Promise<void>((resolve) => {
      const onLow = (): void => {
        dc.removeEventListener("bufferedamountlow", onLow);
        resolve();
      };
      dc.addEventListener("bufferedamountlow", onLow);
      window.setTimeout(() => {
        dc.removeEventListener("bufferedamountlow", onLow);
        resolve();
      }, 1500);
    });
  }
}

const INITIAL_TIMER_SEC = 60;

export function SenderClient() {
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pinRef = useRef<string | null>(null);
  const fileBufferRef = useRef<ArrayBuffer | null>(null);
  const fileMimeRef = useRef<string | null>(null);
  const fileOriginalNameRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(INITIAL_TIMER_SEC);

  const [pin, setPin] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Connecting…");
  const [peerLabel, setPeerLabel] = useState<string>("Waiting for shop PC…");
  const [channelOpen, setChannelOpen] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When set, the A4 crop modal overlays the sender UI for raster images only. */
  const [cropSession, setCropSession] = useState<CropSessionState | null>(null);
  /** Tracks active crop blob URL so we revoke on unload / modal replace. */
  const cropLifecycleRef = useRef<CropSessionState | null>(null);

  const teardownMedia = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setChannelOpen(false);
    setRemainingSec(null);
  }, []);

  const sendTimerPayload = useCallback((msg: ControlMessage) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      return;
    }
    dc.send(JSON.stringify(msg));
  }, []);

  const startTimerLoop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    remainingRef.current = INITIAL_TIMER_SEC;
    setRemainingSec(INITIAL_TIMER_SEC);
    sendTimerPayload({
      kind: "vaultprint-timer",
      remainingSec: INITIAL_TIMER_SEC,
    });
    timerRef.current = setInterval(() => {
      const next = Math.max(0, remainingRef.current - 1);
      remainingRef.current = next;
      setRemainingSec(next);
      sendTimerPayload({ kind: "vaultprint-timer", remainingSec: next });
      if (next <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);
  }, [sendTimerPayload]);

  const disposeCropSession = useCallback(() => {
    const cur = cropLifecycleRef.current;
    if (cur?.objectUrl) {
      URL.revokeObjectURL(cur.objectUrl);
    }
    cropLifecycleRef.current = null;
    setCropSession(null);
  }, []);

  useEffect(() => {
    cropLifecycleRef.current = cropSession;
  }, [cropSession]);

  useEffect(() => {
    return () => {
      const cur = cropLifecycleRef.current;
      if (cur?.objectUrl) {
        URL.revokeObjectURL(cur.objectUrl);
      }
    };
  }, []);

  const sendPreparedFile = useCallback(async () => {
    const dc = dcRef.current;
    const buf = fileBufferRef.current;
    const mime = fileMimeRef.current;
    if (!dc || dc.readyState !== "open" || !buf || !mime) {
      return;
    }
    const start: FileStartMessage = {
      kind: "vaultprint-file-start",
      mimeType: mime,
      byteLength: buf.byteLength,
      suggestedFilename: fileOriginalNameRef.current ?? undefined,
    };
    dc.send(JSON.stringify(start));
    await waitForSendWindow(dc);
    const view = new Uint8Array(buf);
    let offset = 0;
    while (offset < view.byteLength) {
      const end = Math.min(offset + CHUNK_SIZE_BYTES, view.byteLength);
      dc.send(view.slice(offset, end).buffer);
      offset = end;
      await waitForSendWindow(dc);
    }
    setStatus("Document sent — shop can preview and print.");
  }, []);

  const attachOutgoingDocument = useCallback(
    (
      buf: ArrayBuffer,
      mime: string,
      displayName: string,
      hint: string | null,
    ) => {
      fileBufferRef.current = buf;
      fileMimeRef.current = mime;
      fileOriginalNameRef.current = displayName;
      setFileName(displayName);
      setStatus(
        hint ?? "Document ready on device — will send when the link opens.",
      );
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        void sendPreparedFile();
      }
    },
    [sendPreparedFile],
  );

  /** Single mount: connect, wire signaling, build WebRTC exactly once per lifetime. */
  useEffect(() => {
    const url = getSignalingUrl();
    const socket = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    const bootstrapWebRtc = async () => {
      const pinValue = pinRef.current;
      if (!pinValue || pcRef.current) {
        return;
      }
      setPeerLabel("Establishing secure link…");
      const pc = new RTCPeerConnection(DEFAULT_RTC_CONFIGURATION);
      pcRef.current = pc;

      const dc = pc.createDataChannel("vaultprint", { ordered: true });
      dc.bufferedAmountLowThreshold = 256 * 1024;
      dcRef.current = dc;

      dc.onopen = () => {
        setChannelOpen(true);
        setPeerLabel("Peer link active");
        setStatus("Session live — 1:00 window.");
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        remainingRef.current = INITIAL_TIMER_SEC;
        setRemainingSec(INITIAL_TIMER_SEC);
        const dcOpen = dcRef.current;
        if (dcOpen && dcOpen.readyState === "open") {
          dcOpen.send(
            JSON.stringify({
              kind: "vaultprint-timer",
              remainingSec: INITIAL_TIMER_SEC,
            } satisfies ControlMessage),
          );
        }
        timerRef.current = setInterval(() => {
          const next = Math.max(0, remainingRef.current - 1);
          remainingRef.current = next;
          setRemainingSec(next);
          const ch = dcRef.current;
          if (ch && ch.readyState === "open") {
            ch.send(JSON.stringify({ kind: "vaultprint-timer", remainingSec: next }));
          }
          if (next <= 0 && timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }, 1000);
        void sendPreparedFile();
      };

      dc.onclose = () => {
        setChannelOpen(false);
        setPeerLabel("Link closed");
      };

      pc.onicecandidate = (ev) => {
        if (!ev.candidate || !pinRef.current) {
          return;
        }
        socket.emit("signal:ice-candidate", {
          pin: pinRef.current,
          candidate: ev.candidate.toJSON(),
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setError("WebRTC connection failed — check firewalls or try again.");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal:offer", {
        pin: pinValue,
        sdp: pc.localDescription,
      });
    };

    const onRoomCreated = (payload: { pin?: string }) => {
      const p = typeof payload?.pin === "string" ? payload.pin : "";
      if (!isValidSessionCode(p)) {
        return;
      }
      pinRef.current = p;
      setPin(p);
      setStatus("Share this session code with the print shop.");
    };

    const onPeerReady = () => {
      void bootstrapWebRtc();
    };

    const onAnswer = async (payload: {
      pin?: string;
      sdp?: RTCSessionDescriptionInit;
    }) => {
      const pc = pcRef.current;
      const p = pinRef.current;
      if (!pc || !p || payload.pin !== p || !payload.sdp) {
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    };

    const onIce = async (payload: {
      pin?: string;
      candidate?: RTCIceCandidateInit;
    }) => {
      const pc = pcRef.current;
      const p = pinRef.current;
      if (!pc || !p || payload.pin !== p || !payload.candidate) {
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // Ignore spurious ICE races.
      }
    };

    const onSignalingError = (err: SignalingError) => {
      setError(err.message);
    };

    const onRoomClosed = () => {
      setError(
        "Session ended (shop PC closed/refreshed or link torn down). Refresh this page for a new session code.",
      );
      teardownMedia();
    };

    socket.on("connect", () => {
      setStatus("Requesting secure room…");
      socket.emit("sender:create-room");
    });

    socket.on("room-created", onRoomCreated);
    socket.on("peer-ready", onPeerReady);
    socket.on("signal:answer", onAnswer);
    socket.on("signal:ice-candidate", onIce);
    socket.on("error", onSignalingError);
    socket.on("room-closed", onRoomClosed);

    return () => {
      socket.off("room-created", onRoomCreated);
      socket.off("peer-ready", onPeerReady);
      socket.off("signal:answer", onAnswer);
      socket.off("signal:ice-candidate", onIce);
      socket.off("error", onSignalingError);
      socket.off("room-closed", onRoomClosed);
      socket.disconnect();
      socketRef.current = null;
      teardownMedia();
    };
  }, [sendPreparedFile, teardownMedia]);

  const handleFile = useCallback(
    (file: File, buffer: ArrayBuffer) => {
      const mime = mimeForLocalFile(file);
      if (mime.startsWith("image/")) {
        disposeCropSession();
        const objectUrl = URL.createObjectURL(file);
        cropLifecycleRef.current = {
          objectUrl,
          originalFileName: file.name,
        };
        setCropSession({
          objectUrl,
          originalFileName: file.name,
        });
        setStatus(
          "Crop & rotate — we export a centred A4 PDF on this device before sending.",
        );
        return;
      }
      disposeCropSession();
      attachOutgoingDocument(buffer, mime, file.name, null);
    },
    [attachOutgoingDocument, disposeCropSession],
  );

  const onShare = async () => {
    const origin =
      getPublicAppOrigin() ??
      (typeof window !== "undefined" ? window.location.origin : "");
    const receiveUrl = `${origin}/receive`;
    const title = "VaultPrint";
    const text = `Open this link on the shop PC and enter the session code ${pin ?? "------"}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: receiveUrl });
        setShareHint("Link shared.");
      } else {
        await navigator.clipboard.writeText(receiveUrl);
        setShareHint("Link copied to clipboard.");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(receiveUrl);
        setShareHint("Link copied to clipboard.");
      } catch {
        setShareHint("Copy blocked — send the link manually.");
      }
    }
  };

  const extendOneMinute = () => {
    const next = remainingRef.current + 60;
    remainingRef.current = next;
    setRemainingSec(next);
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(
        JSON.stringify({
          kind: "vaultprint-timer-adjust",
          remainingSec: next,
        } satisfies ControlMessage),
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session code</p>
        <p
          className="mt-2 text-center font-extrabold tracking-[0.35em] text-vault-navy"
          style={{ fontSize: "clamp(3rem, 14vw, 4.5rem)", lineHeight: 1 }}
        >
          {pin ?? "•".repeat(SESSION_CODE_LENGTH)}
        </p>
        <p className="mt-2 text-center text-sm text-slate-600">{status}</p>
        {error ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-center text-sm text-vault-danger">
            {error}
          </p>
        ) : null}
      </section>

      <button
        type="button"
        onClick={() => void onShare()}
        disabled={!pin}
        className="min-h-[48px] w-full rounded-xl bg-vault-navy px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        Share receiver link
      </button>
      {shareHint ? <p className="text-center text-sm text-vault-emerald">{shareHint}</p> : null}

      <ImageCropToA4Modal
        open={cropSession !== null}
        imageObjectUrl={cropSession?.objectUrl ?? ""}
        originalFileName={cropSession?.originalFileName ?? ""}
        onCancel={() => {
          disposeCropSession();
          setStatus("Choose a PDF or scan when ready.");
        }}
        onReadyPdf={(pdfArrayBuffer, suggestedFileName) => {
          disposeCropSession();
          attachOutgoingDocument(
            pdfArrayBuffer,
            "application/pdf",
            suggestedFileName,
            "Print-ready A4 PDF — queued; sends when linked.",
          );
        }}
      />

      <FileDropzone disabled={false} fileLabel={fileName} onFile={handleFile} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Secure channel
            </p>
            <p className="text-sm font-medium text-vault-navy">{peerLabel}</p>
            <p className="text-xs text-slate-500">
              {channelOpen
                ? "Data channel open — transfer encrypted peer-to-peer."
                : "Idle"}
            </p>
          </div>
          <span
            className={`h-3 w-3 rounded-full ${
              channelOpen
                ? "bg-vault-emerald shadow-[0_0_0_6px_rgba(16,185,129,0.25)]"
                : "bg-slate-300"
            }`}
            aria-hidden
          />
        </div>
        {remainingSec !== null ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-2xl font-bold tabular-nums text-vault-navy">
              {Math.floor(remainingSec / 60)
                .toString()
                .padStart(2, "0")}
              :
              {(remainingSec % 60).toString().padStart(2, "0")}
              <span className="ml-2 text-sm font-normal text-slate-500">left</span>
            </p>
            <button
              type="button"
              onClick={extendOneMinute}
              className="min-h-[48px] rounded-xl border border-vault-emerald px-4 py-2 text-sm font-semibold text-vault-emerald transition hover:bg-emerald-50"
            >
              +1 min
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
