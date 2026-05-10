/** Pixel crop rectangle from react-easy-crop `croppedAreaPixels`. */
export type PixelCrop = { x: number; y: number; width: number; height: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    /** blob: URLs fail with anonymous cross-origin */
    if (!src.startsWith("blob:") && !src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.src = src;
  });
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Bounding box dimensions after rotating width×height rectangle by deg. */
function rotatedBoxSize(width: number, height: number, rotation: number) {
  const r = rad(rotation);
  return {
    width: Math.abs(Math.cos(r) * width) + Math.abs(Math.sin(r) * height),
    height: Math.abs(Math.sin(r) * width) + Math.abs(Math.cos(r) * height),
  };
}

/** JPEG raster of the cropped pixels (compact for pdf-lib). */
export async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: PixelCrop,
  rotationDegrees: number,
  quality = 0.92,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Cannot get canvas context");
  }

  const rotRad = rad(rotationDegrees);
  const { width: bw, height: bh } = rotatedBoxSize(image.width, image.height, rotationDegrees);

  canvas.width = Math.floor(bw);
  canvas.height = Math.floor(bh);

  ctx.translate(bw / 2, bh / 2);
  ctx.rotate(rotRad);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const cropped = document.createElement("canvas");
  const cctx = cropped.getContext("2d");
  if (!cctx) {
    throw new Error("Cannot get cropped canvas context");
  }

  const cx = Math.floor(pixelCrop.x);
  const cy = Math.floor(pixelCrop.y);
  const cw = Math.max(1, Math.floor(pixelCrop.width));
  const ch = Math.max(1, Math.floor(pixelCrop.height));

  cropped.width = cw;
  cropped.height = ch;

  cctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);

  return await new Promise<Blob>((resolve, reject) => {
    cropped.toBlob(
      (b) => {
        if (b) {
          resolve(b);
        } else {
          reject(new Error("toBlob returned null"));
        }
      },
      "image/jpeg",
      quality,
    );
  });
}
