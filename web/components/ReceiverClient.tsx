"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { DocumentPreview } from "@/components/DocumentPreview";
import { OtpInput } from "@/components/OtpInput";
import { getSignalingUrl } from "@/lib/config";
import {
  detectIcePath,
  icePathDisplay,
  turnConfigHint,
  type IcePathLabel,
} from "@/lib/iceStatus";
import { DEFAULT_RTC_CONFIGURATION } from "@/lib/ice";
import { parseJsonMessage, type AnyJsonMessage } from "@/lib/protocol";
import { SESSION_CODE_LENGTH, sessionCodeLengthLabel } from "@/lib/sessionCode";

type PreviewDocument = {
  id: number;
  buffer: ArrayBuffer;
  mime: string;
  suggestedFilename?: string;
  label: string;
};

export function ReceiverClient() {
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const joinedPinRef = useRef<string | null>(null);
  const nextDocIdRef = useRef(0);
  const batchExpectedRef = useRef<number | null>(null);
  const batchCompleteRef = useRef(false);
  const receivedCountRef = useRef(0);
  const fillStateRef = useRef<{
    target: Uint8Array;
    expected: number;
    filled: number;
    mime: string;
    suggestedFilename?: string;
  } | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const onPeerReadyRef = useRef<() => Promise<void>>(async () => {});

  const [pin, setPin] = useState("");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState(
    `Enter the ${sessionCodeLengthLabel()} code from the customer phone.`,
  );
  const [error, setError] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [documents, setDocuments] = useState<PreviewDocument[]>([]);
  const [printReady, setPrintReady] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [icePath, setIcePath] = useState<IcePathLabel>("not-connected");

  const resetPreview = useCallback(() => {
    nextDocIdRef.current = 0;
    batchExpectedRef.current = null;
    batchCompleteRef.current = false;
    receivedCountRef.current = 0;
    fillStateRef.current = null;
    setDocuments([]);
    setPrintReady(false);
  }, []);

  const killMedia = useCallback(() => {
    resetPreview();
    pcRef.current?.close();
    pcRef.current = null;
    setChannelOpen(false);
    setIcePath("not-connected");
  }, [resetPreview]);

  const onAfterPrint = useCallback(() => {
    resetPreview();
    pcRef.current?.close();
    pcRef.current = null;
    setChannelOpen(false);
    setIcePath("not-connected");
  }, [resetPreview]);

  const finalizeIfReady = useCallback(() => {
    const expected = batchExpectedRef.current;
    const received = receivedCountRef.current;
    const batchDone = batchCompleteRef.current || expected === null;

    if (received === 0) {
      return;
    }

    if (expected !== null && received < expected) {
      setStatus(`Receiving document ${received} of ${expected}…`);
      return;
    }

    if (expected !== null && !batchDone) {
      setStatus(`Received ${received} of ${expected} — finishing transfer…`);
      return;
    }

    setPrintReady(true);
    setStatus(
      received === 1
        ? "Document ready — verify on screen, then print."
        : `${received} documents ready — verify on screen, then print.`,
    );
  }, []);

  const onFileComplete = useCallback(
    (buffer: ArrayBuffer, mime: string, suggestedFilename?: string) => {
      receivedCountRef.current += 1;
      const index = receivedCountRef.current;
      const expected = batchExpectedRef.current;
      const label =
        expected !== null && expected > 1
          ? `Document ${index} of ${expected}${suggestedFilename ? ` — ${suggestedFilename}` : ""}`
          : (suggestedFilename ?? `Document ${index}`);

      setDocuments((prev) => [
        ...prev,
        {
          id: nextDocIdRef.current++,
          buffer,
          mime,
          suggestedFilename,
          label,
        },
      ]);
      finalizeIfReady();
    },
    [finalizeIfReady],
  );

  const handleChannelMessage = useRef<
    (evMsg: MessageEvent<string | ArrayBuffer | Blob>) => Promise<void>
  >(async () => {});

  useEffect(() => {
    handleChannelMessage.current = async (evMsg) => {
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
        if (parsed.kind === "vaultprint-batch-start") {
          resetPreview();
          batchExpectedRef.current = parsed.totalFiles;
          setStatus(
            parsed.totalFiles === 1
              ? "Receiving encrypted document…"
              : `Receiving batch — ${parsed.totalFiles} documents…`,
          );
          return;
        }
        if (parsed.kind === "vaultprint-batch-complete") {
          batchCompleteRef.current = true;
          finalizeIfReady();
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
        return;
      }

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
        const out = state.target.slice().buffer;
        const { mime, suggestedFilename } = state;
        fillStateRef.current = null;
        onFileComplete(out, mime, suggestedFilename);
      }
    };
  }, [finalizeIfReady, onFileComplete, resetPreview]);

  useEffect(() => {
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [onAfterPrint]);

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
  }, [killMedia]);

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
        void detectIcePath(pc).then(setIcePath);
      };
      ch.onmessage = (evMsg) => {
        void handleChannelMessage.current(evMsg);
      };
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        setError("Secure link failed — check network and session code.");
      }
      if (pc.connectionState === "connected") {
        void detectIcePath(pc).then(setIcePath);
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

  const hasPreview = documents.length > 0;

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
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                channelOpen ? "bg-vault-emerald" : "bg-slate-300"
              }`}
            />
            Data channel: {channelOpen ? "open" : "idle"}
          </div>
          {channelOpen ? (
            <p>ICE path: {icePathDisplay(icePath)}</p>
          ) : turnConfigHint() ? (
            <p className="text-amber-700">{turnConfigHint()}</p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center px-2">
        <div
          className="vault-print-only vault-print-sheet relative max-h-[72vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-card print:max-h-none print:w-full print:overflow-visible"
          onContextMenu={(e) => e.preventDefault()}
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
        >
          <div className="vault-print-host space-y-6">
            {documents.map((doc) => (
              <DocumentPreview
                key={doc.id}
                buffer={doc.buffer}
                mime={doc.mime}
                suggestedFilename={doc.suggestedFilename}
                label={documents.length > 1 ? doc.label : undefined}
              />
            ))}
          </div>

          {!hasPreview ? (
            <p className="mt-6 text-center text-sm text-slate-500">
              Encrypted preview will appear here — nothing is written to disk.
            </p>
          ) : !printReady ? (
            <p className="no-print mt-4 text-center text-xs text-slate-500">
              Rendering incoming documents…
            </p>
          ) : documents.length > 1 ? (
            <p className="no-print mt-4 text-center text-xs text-slate-500">
              {documents.length} documents — scroll to review all pages before printing.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onPrint}
          disabled={!printReady || !hasPreview}
          className="no-print mt-8 min-h-[56px] w-full max-w-xl rounded-2xl bg-vault-emerald px-6 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          PRINT
        </button>
      </section>
    </div>
  );
}
