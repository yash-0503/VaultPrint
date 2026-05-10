/**
 * VaultPrint data-channel framing (JSON control messages + binary file chunks).
 * All binary payloads after the initial metadata message are raw ArrayBuffer slices.
 */

/** 16 KiB — avoids large single RTCDataChannel message pressure. */
export const CHUNK_SIZE_BYTES = 16 * 1024;

/** First message on the wire is always JSON with this discriminant. */
export type FileStartMessage = {
  kind: "vaultprint-file-start";
  /** MIME, e.g. application/pdf or image/png */
  mimeType: string;
  byteLength: number;
  /** Original filename (basename) for MIME inference when type is missing on mobile. */
  suggestedFilename?: string;
};

/** Sender → receiver: timer sync / extensions (sent as JSON strings). */
export type ControlMessage =
  | {
      kind: "vaultprint-timer";
      /** Seconds remaining in this secure session window. */
      remainingSec: number;
    }
  | {
      kind: "vaultprint-timer-adjust";
      /** Absolute new remaining seconds after e.g. "+1 min" adjustments. */
      remainingSec: number;
    };

export type AnyJsonMessage = FileStartMessage | ControlMessage;

export function parseJsonMessage(raw: string): AnyJsonMessage | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null || !("kind" in v)) {
      return null;
    }
    return v as AnyJsonMessage;
  } catch {
    return null;
  }
}
