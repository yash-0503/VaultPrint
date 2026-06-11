"use client";

import { useEffect, useRef, useState } from "react";

import { appendDocumentToHost, clearPreviewHost } from "@/lib/renderDocument";

export interface DocumentPreviewProps {
  buffer: ArrayBuffer;
  mime: string;
  suggestedFilename?: string;
  label?: string;
}

/** Renders one received file (all PDF pages) into a stable React subtree. */
export function DocumentPreview({
  buffer,
  mime,
  suggestedFilename,
  label,
}: DocumentPreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;
    setReady(false);
    setRenderError(null);
    clearPreviewHost(host);

    void (async () => {
      try {
        await appendDocumentToHost(host, buffer, mime, suggestedFilename);
        if (!cancelled) {
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setRenderError(
            e instanceof Error ? e.message : "Could not render this document.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      clearPreviewHost(host);
    };
  }, [buffer, mime, suggestedFilename]);

  return (
    <article className="vault-print-document">
      {label ? (
        <p className="no-print mb-3 truncate text-xs font-semibold text-slate-500">{label}</p>
      ) : null}
      <div ref={hostRef} className="vault-print-document-body" />
      {!ready && !renderError ? (
        <p className="py-6 text-center text-xs text-slate-400">Rendering preview…</p>
      ) : null}
      {renderError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-vault-danger">{renderError}</p>
      ) : null}
    </article>
  );
}
