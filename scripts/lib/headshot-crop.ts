/**
 * Square crop geometry for panel headshots (TH-33).
 *
 * Given the dimensions of an original image and a vertical focal point
 * (0 = top edge, 1 = bottom edge, 0.5 = centre), return the largest square
 * box that is horizontally centred and vertically centred on the focal row,
 * clamped so it stays inside the image. With focusY = 0.5 this is exactly
 * the centre crop the sync script produced before TH-33, so members that do
 * not set `cropFocusY` are unaffected byte-for-byte.
 */
export type CropBox = { left: number; top: number; size: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function squareCropBox(width: number, height: number, focusY = 0.5): CropBox {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`squareCropBox: width and height must be positive integers, got ${width}x${height}`);
  }
  if (typeof focusY !== "number" || Number.isNaN(focusY) || focusY < 0 || focusY > 1) {
    throw new Error(`squareCropBox: focusY must be a number in 0..1, got ${focusY}`);
  }
  const size = Math.min(width, height);
  const top = clamp(Math.round(focusY * height - size / 2), 0, height - size);
  const left = clamp(Math.round(0.5 * width - size / 2), 0, width - size);
  return { left, top, size };
}
