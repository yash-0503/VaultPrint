import type { Options as DocxPreviewOptions } from "docx-preview";

import { MIME_DOCX, resolveWireMime } from "@/lib/mime";

export type DocumentSurface = "canvas" | "docx";

function pdfScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(1200 / viewportWidth, 1600 / viewportHeight, 2.5);
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

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

async function renderPdfPages(
  buffer: ArrayBuffer,
  section: HTMLElement,
): Promise<number> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = pdfScale(baseViewport.width, baseViewport.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.className = "vault-print-canvas vault-print-page";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error(`Could not create canvas for PDF page ${pageNum}.`);
    }
    await page.render({ canvasContext: ctx, viewport }).promise;
    section.appendChild(canvas);
  }

  return pdf.numPages;
}

/** Append one received document into the preview/print host. */
export async function appendDocumentToHost(
  host: HTMLElement,
  buffer: ArrayBuffer,
  wireMime: string,
  suggestedFilename: string | undefined,
): Promise<DocumentSurface> {
  const effective = resolveWireMime(wireMime, buffer, suggestedFilename);
  const section = document.createElement("div");
  section.className = "vault-print-document-body";

  const isDocx =
    effective === MIME_DOCX ||
    effective.toLowerCase().includes("wordprocessingml.document");

  if (isDocx) {
    const docxInner = document.createElement("div");
    docxInner.className = "vault-docx-host text-[14px] leading-relaxed text-vault-navy";
    section.appendChild(docxInner);
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
    await renderAsync(blob, docxInner, undefined, opts);
    section.appendChild(docxInner);
    host.appendChild(section);
    return "docx";
  }

  if (effective.startsWith("image/")) {
    const canvas = document.createElement("canvas");
    canvas.className = "vault-print-canvas vault-print-page";
    await drawRasterImage(buffer, effective, canvas);
    section.appendChild(canvas);
    host.appendChild(section);
    return "canvas";
  }

  if (effective === "application/pdf" || effective.endsWith("/pdf")) {
    const pages = await renderPdfPages(buffer, section);
    if (pages === 0) {
      throw new Error("PDF has no pages.");
    }
    host.appendChild(section);
    return "canvas";
  }

  throw new Error(`Unsupported or unrecognized file type (${effective}).`);
}

export function clearPreviewHost(host: HTMLElement | null): void {
  if (!host) {
    return;
  }
  host.innerHTML = "";
}
