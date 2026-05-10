"use client";

import { useEffect, useRef, useState } from "react";
import type { Options as DocxPreviewOptions } from "docx-preview";
import { io, type Socket } from "socket.io-client";

import { OtpInput } from "@/components/OtpInput";
import { getSignalingUrl } from "@/lib/config";
import { DEFAULT_RTC_CONFIGURATION } from "@/lib/ice";
import { MIME_DOCX, resolveWireMime } from "@/lib/mime";
import { parseJsonMessage, type AnyJsonMessage } from "@/lib/protocol";
import { SESSION_CODE_LENGTH, sessionCodeLengthLabel } from "@/lib/sessionCode";

type PreviewSurface = "none" | "canvas" | "docx";

function wipeCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

async function drawRasterImage(
  buffer: ArrayBuffer,
  mime: string,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const blob = new Blob([buffer], { type: mime });

  try {
    const bmp = await createImageBitmap(blob);
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return;
  } catch {
    //
  }

  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        resolve();
      };
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderDocumentPreview(
  buffer: ArrayBuffer,
  wireMime: string,
  suggestedFilename: string | undefined,
  canvas: HTMLCanvasElement | null,
  docxHost: HTMLDivElement | null,
): Promise<PreviewSurface> {
  const effective = resolveWireMime(wireMime, buffer, suggestedFilename);
  docxHost && (docxHost.innerHTML = "");
  wipeCanvas(canvas);

  const isDocx =
    effective === MIME_DOCX ||
    effective.toLowerCase().includes("wordprocessingml.document");

  if (isDocx) {
    if (!docxHost) {
      throw new Error("Missing document container for Word preview.");
    }
    const blob = new Blob([buffer], { type: MIME_DOCX });
    const { renderAsync } = await import("docx-preview");
    const opts: Partial<DocxPreviewOptions> = {
      hideWrapperOnPrint: true,
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      className: "vault-print-docx-inner",
    };
    await renderAsync(blob, docxHost, undefined, opts);
    return "docx";
  }

  if (!canvas) {
    throw new Error("Missing canvas for raster/PDF preview.");
  }

  if (effective.startsWith("image/")) {
    await drawRasterImage(buffer, effective, canvas);
    return "canvas";
  }

  if (effective === "application/pdf" || effective.endsWith("/pdf")) {
    const pdfjs = await import("pdfjs-dist");
    /** Self-hosted worker (see public/pdf.worker.min.mjs; synced via npm postinstall to match pdfjs-dist). */
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1200 / baseViewport.width, 1600 / baseViewport.height, 2.5);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return "canvas";
    }
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;
    return "canvas";
  }

  throw new Error(`Unsupported or unrecognized file type (${effective}).`);
}

export function ReceiverClient() {
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const joinedPinRef = useRef<string | null>(null);
  const fileBufferRef = useRef<ArrayBuffer | null>(null);
  const fillStateRef = useRef<{
    target: Uint8Array;
    expected: number;
    filled: number;
    mime: string;
    suggestedFilename?: string;
  } | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docxHostRef = useRef<HTMLDivElement | null>(null);
  const onPeerReadyRef = useRef<() => Promise<void>>(async () => {});

  const [pin, setPin] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState(
    `Enter the ${sessionCodeLengthLabel()} code from the customer phone.`,
  );
  const [error, setError] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>("none");
  const [channelOpen, setChannelOpen] = useState(false);

  const killMedia = () => {
    fileBufferRef.current = null;
    fillStateRef.current = null;
    wipeCanvas(canvasRef.current);
    if (docxHostRef.current) {
      docxHostRef.current.innerHTML = "";
    }
    setPreviewSurface("none");
    setPreviewReady(false);
    pcRef.current?.close();
    pcRef.current = null;
    setChannelOpen(false);
  };

  const onBeforePrint = () => {
    /** Keep DOM intact until layout for print completes. */
  };

  const onAfterPrint = () => {
    fileBufferRef.current = new ArrayBuffer(0);
    fillStateRef.current = null;
    wipeCanvas(canvasRef.current);
    if (docxHostRef.current) {
      docxHostRef.current.innerHTML = "";
    }
    setPreviewSurface("none");
    setPreviewReady(false);
    pcRef.current?.close();
    pcRef.current = null;
    setChannelOpen(false);
  };

  useEffect(() => {
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  useEffect(() => {
    const url = getSignalingUrl();
    const socket = io(url, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    const applyOffer = async (desc: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      const pinValue = joinedPinRef.current;
      if (!pinValue) {
        return;
      }
      if (!pc) {
        pendingOfferRef.current = desc;
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(desc));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal:answer", { pin: pinValue, sdp: pc.localDescription });
    };

    socket.on("signal:offer", async (payload: { pin?: string; sdp?: RTCSessionDescriptionInit }) => {
      if (
        !joinedPinRef.current ||
        payload.pin !== joinedPinRef.current ||
        !payload.sdp
      ) {
        return;
      }
      await applyOffer(payload.sdp);
    });

    socket.on(
      "signal:ice-candidate",
      async (payload: { pin?: string; candidate?: RTCIceCandidateInit }) => {
        const pc = pcRef.current;
        const pinValue = joinedPinRef.current;
        if (!pc || !pinValue || payload.pin !== pinValue || !payload.candidate) {
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // ignore
        }
      },
    );

    socket.on("peer-ready", () => {
      void onPeerReadyRef.current();
    });

    socket.on("error", (err: { message?: string }) => {
      setError(err.message ?? "Signaling error");
    });

    socket.on("room-closed", () => {
      setError(
        "Session closed — ask the customer to generate a new session code on their phone.",
      );
      killMedia();
    });

    return () => {
      socket.off("signal:offer");
      socket.off("signal:ice-candidate");
      socket.off("peer-ready");
      socket.off("error");
      socket.off("room-closed");
      socket.disconnect();
      socketRef.current = null;
      killMedia();
    };
  }, []);

  onPeerReadyRef.current = async () => {
    if (!joinedPinRef.current || pcRef.current) {
      return;
    }

    const socket = socketRef.current;
    const pinValue = joinedPinRef.current;
    if (!socket || !pinValue) {
      return;
    }

    setStatus("Pairing securely…");

    const pc = new RTCPeerConnection(DEFAULT_RTC_CONFIGURATION);
    pcRef.current = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !joinedPinRef.current) {
        return;
      }
      socket.emit("signal:ice-candidate", {
        pin: joinedPinRef.current,
        candidate: ev.candidate.toJSON(),
      });
    };

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      ch.binaryType = "arraybuffer";
      ch.onopen = () => {
        setChannelOpen(true);
        setStatus("Receiving encrypted document…");
      };
      ch.onmessage = async (evMsg) => {
        if (typeof evMsg.data === "string") {
          const parsed: AnyJsonMessage | null = parseJsonMessage(evMsg.data);
          if (!parsed) {
            return;
          }
          if (
            parsed.kind === "vaultprint-timer" ||
            parsed.kind === "vaultprint-timer-adjust"
          ) {
            setRemainingSec(parsed.remainingSec);
            return;
          }
          if (parsed.kind === "vaultprint-file-start") {
            const suggestedFilename =
              typeof parsed.suggestedFilename === "string"
                ? parsed.suggestedFilename
                : undefined;
            fillStateRef.current = {
              target: new Uint8Array(parsed.byteLength),
              expected: parsed.byteLength,
              filled: 0,
              mime: parsed.mimeType,
              suggestedFilename,
            };
            return;
          }
        } else {
          let rawBuf: ArrayBuffer | null = null;
          if (evMsg.data instanceof ArrayBuffer) {
            rawBuf = evMsg.data;
          } else if (evMsg.data instanceof Blob) {
            rawBuf = await evMsg.data.arrayBuffer();
          }
          if (!rawBuf) {
            return;
          }
          const state = fillStateRef.current;
          if (!state) {
            return;
          }
          const chunk = new Uint8Array(rawBuf);
          state.target.set(chunk, state.filled);
          state.filled += chunk.byteLength;
          if (state.filled >= state.expected) {
            /** Copy-only buffer (no pooled slack after the typed array). */
            const out = state.target.slice().buffer;
            fileBufferRef.current = out;
            fillStateRef.current = null;
            setPreviewReady(true);
            setStatus("Document ready — verify on screen, then print.");
            try {
              const surface = await renderDocumentPreview(
                out,
                state.mime,
                state.suggestedFilename,
                canvasRef.current,
                docxHostRef.current,
              );
              setPreviewSurface(surface);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not render preview for this file type.",
              );
              setPreviewSurface("none");
            }
          }
        }
      };
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        setError("Secure link failed — check network and session code.");
      }
    };

    const pending = pendingOfferRef.current;
    if (pending) {
      pendingOfferRef.current = null;
      await pc.setRemoteDescription(new RTCSessionDescription(pending));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal:answer", { pin: pinValue, sdp: pc.localDescription });
    }
  };

  const joinSession = () => {
    const normalized = pin.replace(/\D/g, "").slice(0, SESSION_CODE_LENGTH);
    if (normalized.length !== SESSION_CODE_LENGTH) {
      setError(`Enter all ${SESSION_CODE_LENGTH} digits.`);
      return;
    }
    setError(null);
    joinedPinRef.current = normalized;
    setJoined(true);
    setStatus("Connecting…");
    socketRef.current?.emit("receiver:join", { pin: normalized });
  };

  const onPrint = () => {
    window.print();
  };

  return (
    <div className="vault-print-root vault-locked flex min-h-[80vh] flex-col gap-8 print-root">
      <section className="no-print space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
        <h2 className="text-lg font-semibold text-vault-navy">Enter customer session code</h2>
        <OtpInput
          length={SESSION_CODE_LENGTH}
          value={pin}
          onChange={(v) =>
            setPin(v.replace(/\D/g, "").slice(0, SESSION_CODE_LENGTH))
          }
          disabled={joined}
        />
        {!joined ? (
          <button
            type="button"
            onClick={joinSession}
            className="min-h-[48px] w-full rounded-xl bg-vault-navy px-4 py-3 text-base font-semibold text-white hover:bg-slate-900"
          >
            Connect securely
          </button>
        ) : (
          <p className="text-sm text-slate-600">Code locked for this session.</p>
        )}
        <p className="text-xs text-slate-500">
          Closing or refreshing ends the session permanently — this code cannot be reused.
        </p>
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-vault-danger">{error}</p>
        ) : (
          <p className="text-sm text-slate-600">{status}</p>
        )}
        {remainingSec !== null ? (
          <p className="text-4xl font-bold tabular-nums text-vault-navy">
            {Math.floor(remainingSec / 60)
              .toString()
              .padStart(2, "0")}
            :
            {(remainingSec % 60).toString().padStart(2, "0")}
            <span className="ml-3 text-base font-normal text-slate-500">
              session time remaining
            </span>
          </p>
        ) : null}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span
            className={`h-2 w-2 rounded-full ${
              channelOpen ? "bg-vault-emerald" : "bg-slate-300"
            }`}
          />
          Data channel: {channelOpen ? "open" : "idle"}
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center px-2">
        <div
          className="vault-print-only vault-print-sheet relative max-h-[72vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-card print:max-h-none print:w-full print:overflow-visible"
          onContextMenu={(e) => e.preventDefault()}
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
        >
          <canvas
            ref={canvasRef}
            className={`vault-print-canvas mx-auto block max-h-[65vh] w-auto max-w-full bg-vault-canvas ${
              previewSurface === "docx" ? "hidden" : ""
            }`}
          />
          <div
            ref={docxHostRef}
            className={`vault-docx-host text-[14px] leading-relaxed text-vault-navy ${
              previewSurface === "docx" ? "block" : "hidden"
            }`}
          />

          {!previewReady ? (
            <p className="mt-6 text-center text-sm text-slate-500">
              Encrypted preview will appear here — nothing is written to disk.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onPrint}
          disabled={!previewReady}
          className="no-print mt-8 min-h-[56px] w-full max-w-xl rounded-2xl bg-vault-emerald px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          PRINT
        </button>
      </section>
    </div>
  );
}
