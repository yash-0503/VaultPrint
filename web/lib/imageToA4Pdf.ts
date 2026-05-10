import { PDFDocument } from "pdf-lib";

/** ISO A4 portrait in PDF points */
export const PDF_A4_WIDTH_PT = 595;
export const PDF_A4_HEIGHT_PT = 842;

/**
 * Matches product spec (40pt gutter — user formula used 595-40 wide, 842-40 tall for scale).
 */
const AVAILABLE_WIDTH_PT = PDF_A4_WIDTH_PT - 40; // 555
const AVAILABLE_HEIGHT_PT = PDF_A4_HEIGHT_PT - 40; // 802

/**
 * Embeds raster image into a single-page centred A4 PDF with uniform scaling.
 */
export async function imageBlobToA4Pdf(arrayBufferLike: Blob): Promise<ArrayBuffer> {
  const imageBytes = new Uint8Array(await arrayBufferLike.arrayBuffer());
  const pdfDoc = await PDFDocument.create();

  let embeddedImage;
  try {
    embeddedImage = await pdfDoc.embedJpg(imageBytes);
  } catch {
    try {
      embeddedImage = await pdfDoc.embedPng(imageBytes);
    } catch {
      throw new Error("Could not embed image into PDF — use JPEG or PNG bytes.");
    }
  }

  const page = pdfDoc.addPage([PDF_A4_WIDTH_PT, PDF_A4_HEIGHT_PT]);

  const iw = embeddedImage.width;
  const ih = embeddedImage.height;

  const scaleFactor = Math.min(
    AVAILABLE_WIDTH_PT / iw,
    AVAILABLE_HEIGHT_PT / ih,
  );
  const drawW = iw * scaleFactor;
  const drawH = ih * scaleFactor;

  const x = (PDF_A4_WIDTH_PT - drawW) / 2;
  const y = (PDF_A4_HEIGHT_PT - drawH) / 2;

  page.drawImage(embeddedImage, {
    x,
    y,
    width: drawW,
    height: drawH,
  });

  const out = await pdfDoc.save();
  /** Detach pooled buffer for reliable WebRTC chunking */
  const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  return ab as ArrayBuffer;
}
