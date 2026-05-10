/** Map `photo.jpg` → `photo-print-ready.pdf`. */
export function toPrintReadyPdfName(originalName: string): string {
  const trimmed = originalName.trim();
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${base || "vaultprint"}-print-ready.pdf`;
}
