"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area, MediaSize } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";

import { type PixelCrop, getCroppedImageBlob } from "@/lib/getCroppedImageBlob";
import { imageBlobToA4Pdf } from "@/lib/imageToA4Pdf";
import { toPrintReadyPdfName } from "@/lib/pdfFileName";

export type AspectMode = "free" | "id32";

export interface ImageCropToA4ModalProps {
  open: boolean;
  imageObjectUrl: string;
  originalFileName: string;
  onCancel: () => void;
  onReadyPdf: (pdfArrayBuffer: ArrayBuffer, suggestedFileName: string) => void;
}

export function ImageCropToA4Modal({
  open,
  imageObjectUrl,
  originalFileName,
  onCancel,
  onReadyPdf,
}: ImageCropToA4ModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspectMode, setAspectMode] = useState<AspectMode>("id32");
  /** “Free”: match natural media AR (not 3∶2 lock). Crop box still draggable via zoom/pan. */
  const mediaRatioRef = useRef<number>(4 / 3);
  const aspectModeRef = useRef<AspectMode>("id32");
  const [aspect, setAspect] = useState(3 / 2);

  useEffect(() => {
    aspectModeRef.current = aspectMode;
  }, [aspectMode]);

  const pixelsRef = useRef<PixelCrop | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_a: Area, pixels: Area) => {
    pixelsRef.current = pixels;
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setError(null);
    setAspectMode("id32");
    setAspect(3 / 2);
    pixelsRef.current = null;
  }, [open, imageObjectUrl]);

  const onMediaLoaded = useCallback((size: MediaSize) => {
    const r =
      size.naturalHeight > 0 ? size.naturalWidth / size.naturalHeight : 4 / 3;
    mediaRatioRef.current = r;
    if (aspectModeRef.current === "free") {
      setAspect(r);
    }
  }, []);

  const selectId32 = () => {
    setAspectMode("id32");
    setAspect(3 / 2);
  };

  const selectFreePhotoRatio = () => {
    setAspectMode("free");
    setAspect(mediaRatioRef.current);
  };

  const confirm = async () => {
    const pixels = pixelsRef.current;
    if (!pixels || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const croppedJpeg = await getCroppedImageBlob(
        imageObjectUrl,
        pixels,
        rotation,
        0.95,
      );
      const pdfBuf = await imageBlobToA4Pdf(croppedJpeg);
      onReadyPdf(pdfBuf, toPrintReadyPdfName(originalFileName));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build print PDF.");
    } finally {
      setBusy(false);
    }
  };

  if (!open || !imageObjectUrl) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Crop image for A4 PDF"
    >
      <div className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-bold text-vault-navy">Crop for A4 PDF</h2>
          <p className="mt-1 text-xs text-slate-600">
            Pinch or drag to frame the document — use <span className="font-medium">3∶2</span>{" "}
            for typical ID proportions. Rendering is centred on an A4 PDF in the browser — no upload.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={`min-h-[40px] flex-1 rounded-lg border px-2 text-xs font-semibold transition ${
                aspectMode === "id32"
                  ? "border-vault-emerald bg-emerald-50 text-vault-navy"
                  : "border-slate-200 text-slate-600"
              }`}
              onClick={selectId32}
            >
              3∶2 ID-style
            </button>
            <button
              type="button"
              className={`min-h-[40px] flex-1 rounded-lg border px-2 text-xs font-semibold transition ${
                aspectMode === "free"
                  ? "border-vault-emerald bg-emerald-50 text-vault-navy"
                  : "border-slate-200 text-slate-600"
              }`}
              onClick={selectFreePhotoRatio}
            >
              Full-photo ratio
            </button>
          </div>
        </div>

        <div className="relative mx-auto mt-3 h-[min(52vh,420px)] w-full max-w-md bg-slate-900">
          <Cropper
            image={imageObjectUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            onMediaLoaded={onMediaLoaded}
            cropShape="rect"
            showGrid={true}
            objectFit="contain"
          />
        </div>

        <div className="space-y-3 px-4 py-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Zoom
            <input
              type="range"
              min={1}
              max={4}
              step={0.02}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Rotate (°)
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-full"
            />
          </label>
          {error ? (
            <p className="text-center text-xs text-vault-danger">{error}</p>
          ) : null}
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[48px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-vault-navy hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="min-h-[48px] rounded-xl bg-vault-navy px-4 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {busy ? "Building PDF…" : "Use cropped area"}
          </button>
        </div>
      </div>
    </div>
  );
}
