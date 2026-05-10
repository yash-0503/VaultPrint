/**
 * Mobile uploads often omit `File.type` or send `application/octet-stream`.
 * We sniff magic bytes and infer from extension so routing works for PDF, images, and DOCX.
 */

/** OOXML Word document (.docx). */
export const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function guessMimeFromFilename(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".docx")) {
    return MIME_DOCX;
  }
  return null;
}

/**
 * DOCX is a ZIP whose entries include `word/document*.xml`. Distinguishes from .xlsx/.pptx.
 */
export function sniffOoxmlWordDocx(buffer: ArrayBuffer): boolean {
  const n = Math.min(buffer.byteLength, 65536);
  if (n < 4) {
    return false;
  }
  const u = new Uint8Array(buffer, 0, n);
  if (u[0] !== 0x50 || u[1] !== 0x4b) {
    return false;
  }
  const text = new TextDecoder("latin1").decode(u);
  return (
    text.includes("word/document") &&
    (text.includes("[Content_Types].xml") ||
      text.includes("word/header") ||
      text.includes("word/footer") ||
      text.includes("word/settings"))
  );
}

/**
 * Inspect the first bytes of a buffer (works even when `Blob.type` is empty).
 */
export function sniffMimeFromBytes(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < 12) {
    return null;
  }
  const u8 = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength));

  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47 &&
    u8[4] === 0x0d &&
    u8[5] === 0x0a &&
    u8[6] === 0x1a &&
    u8[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return "image/webp";
  }
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) {
    return "application/pdf";
  }
  return null;
}

/**
 * Prefer declared type when reliable; otherwise sniff bytes, then filename (sender only).
 */
export function mimeForLocalFile(file: File): string {
  const declared = file.type?.trim();
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== "application/x-www-form-urlencoded"
  ) {
    if (declared === "application/zip") {
      return guessMimeFromFilename(file.name) ?? declared;
    }
    return declared;
  }
  return guessMimeFromFilename(file.name) ?? declared ?? "application/octet-stream";
}

/**
 * Receiver-side: combine wire MIME, magic bytes, and optional basename from the sender.
 */
export function resolveWireMime(
  declared: string,
  buffer: ArrayBuffer,
  suggestedFilename?: string | null,
): string {
  const fromName =
    suggestedFilename && suggestedFilename.trim().length > 0
      ? guessMimeFromFilename(suggestedFilename.trim())
      : null;

  const d = declared.trim().toLowerCase();

  if (
    sniffOoxmlWordDocx(buffer) &&
    (!d || d === "application/octet-stream" || d === "application/zip")
  ) {
    return MIME_DOCX;
  }

  if (d && d !== "application/octet-stream" && d !== "application/zip") {
    return declared;
  }

  const sniff = sniffMimeFromBytes(buffer);
  if (sniff) {
    return sniff;
  }
  if (sniffOoxmlWordDocx(buffer)) {
    return MIME_DOCX;
  }
  if (fromName) {
    return fromName;
  }
  return declared || "application/octet-stream";
}
