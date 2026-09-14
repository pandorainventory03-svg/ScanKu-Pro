import { QuadCorners } from '../types';

/**
 * Perspective unwarping (homography) with bilinear interpolation.
 * Transforms any quadrilateral document into a flat rectangular document.
 */

export function perspectiveTransform(
  srcImg: HTMLImageElement | HTMLCanvasElement,
  corners: QuadCorners
): HTMLCanvasElement {
  const { tl, tr, br, bl } = corners;

  // Calculate output rectangular dimensions from the quad sides
  const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const wBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const hLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const hRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  // Clamp output resolution to sensible maximum for mobile performance
  const rawW = Math.max(wTop, wBot);
  const rawH = Math.max(hLeft, hRight);

  // Max dimension 2200px for crisp high-resolution text
  const maxDim = 2200;
  const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
  const outW = Math.max(100, Math.round(rawW * scale));
  const outH = Math.max(100, Math.round(rawH * scale));

  // Source image data
  const srcCanvas = document.createElement('canvas');
  const sw = 'naturalWidth' in srcImg ? srcImg.naturalWidth : srcImg.width;
  const sh = 'naturalHeight' in srcImg ? srcImg.naturalHeight : srcImg.height;
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error("Could not create canvas context");

  srcCtx.drawImage(srcImg, 0, 0, sw, sh);
  const srcData = srcCtx.getImageData(0, 0, sw, sh).data;

  // Compute projective transformation matrix from unit square to quadrilateral
  // [0,0]->tl, [1,0]->tr, [1,1]->br, [0,1]->bl
  const dx1 = tr.x - br.x;
  const dx2 = bl.x - br.x;
  const dx3 = tl.x - tr.x + br.x - bl.x;
  const dy1 = tr.y - br.y;
  const dy2 = bl.y - br.y;
  const dy3 = tl.y - tr.y + br.y - bl.y;

  let h11: number, h12: number, h13: number;
  let h21: number, h22: number, h23: number;
  let h31: number, h32: number;

  if (Math.abs(dx3) < 1e-6 && Math.abs(dy3) < 1e-6) {
    // Affine approximation
    h11 = tr.x - tl.x;
    h12 = bl.x - tl.x;
    h13 = tl.x;
    h21 = tr.y - tl.y;
    h22 = bl.y - tl.y;
    h23 = tl.y;
    h31 = 0;
    h32 = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denom) < 1e-8) {
      // Degenerate matrix fallback
      h11 = tr.x - tl.x;
      h12 = bl.x - tl.x;
      h13 = tl.x;
      h21 = tr.y - tl.y;
      h22 = bl.y - tl.y;
      h23 = tl.y;
      h31 = 0;
      h32 = 0;
    } else {
      h31 = (dx3 * dy2 - dx2 * dy3) / denom;
      h32 = (dx1 * dy3 - dx3 * dy1) / denom;
      h11 = tr.x - tl.x + h31 * tr.x;
      h12 = bl.x - tl.x + h32 * bl.x;
      h13 = tl.x;
      h21 = tr.y - tl.y + h31 * tr.y;
      h22 = bl.y - tl.y + h32 * bl.y;
      h23 = tl.y;
    }
  }

  // Create destination canvas
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error("Could not create destination context");

  const outImg = outCtx.createImageData(outW, outH);
  const outPx = outImg.data;

  // Bilinear interpolation mapping output coordinates (ox, oy) to source coordinates (sx, sy)
  for (let oy = 0; oy < outH; oy++) {
    const v = oy / (outH - 1 || 1);
    const rowOffset = oy * outW * 4;

    for (let ox = 0; ox < outW; ox++) {
      const u = ox / (outW - 1 || 1);
      const w = h31 * u + h32 * v + 1;
      const sx = (h11 * u + h12 * v + h13) / w;
      const sy = (h21 * u + h22 * v + h23) / w;

      const oi = rowOffset + ox * 4;

      if (sx >= 0 && sx < sw - 1 && sy >= 0 && sy < sh - 1) {
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;

        const i00 = (y0 * sw + x0) * 4;
        const i10 = (y0 * sw + x0 + 1) * 4;
        const i01 = ((y0 + 1) * sw + x0) * 4;
        const i11 = ((y0 + 1) * sw + x0 + 1) * 4;

        for (let c = 0; c < 3; c++) {
          const v00 = srcData[i00 + c];
          const v10 = srcData[i10 + c];
          const v01 = srcData[i01 + c];
          const v11 = srcData[i11 + c];
          const top = v00 + (v10 - v00) * fx;
          const bot = v01 + (v11 - v01) * fx;
          outPx[oi + c] = top + (bot - top) * fy;
        }
        outPx[oi + 3] = 255;
      } else {
        // Border padding (clean white)
        outPx[oi] = 255;
        outPx[oi + 1] = 255;
        outPx[oi + 2] = 255;
        outPx[oi + 3] = 255;
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}
