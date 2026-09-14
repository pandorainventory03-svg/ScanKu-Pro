import { ScanFilterMode } from '../types';

/**
 * Professional Document Image Enhancement Engine
 * Supports Magic Color, High-Clarity Black & White, and Grayscale filters.
 */

function boxBlurChannel(channel: Float32Array, W: number, H: number, windowSize: number): Float32Array {
  const IW = W + 1;
  const integral = new Float64Array(IW * (H + 1));

  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    const yW = y * W;
    const yIW = y * IW;
    const yNextIW = (y + 1) * IW;

    for (let x = 0; x < W; x++) {
      rowSum += channel[yW + x];
      integral[yNextIW + (x + 1)] = integral[yIW + (x + 1)] + rowSum;
    }
  }

  const r = Math.floor(windowSize / 2);
  const out = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - r);
    const y2 = Math.min(H - 1, y + r);
    const yW = y * W;
    const y1IW = y1 * IW;
    const y2NextIW = (y2 + 1) * IW;

    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - r);
      const x2 = Math.min(W - 1, x + r);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      const sum =
        integral[y2NextIW + (x2 + 1)] -
        integral[y1IW + (x2 + 1)] -
        integral[y2NextIW + x1] +
        integral[y1IW + x1];

      out[yW + x] = sum / count;
    }
  }
  return out;
}

function gaussianBlur3x3(gray: Float32Array, W: number, H: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const yW = y * W;
    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - 1);
      const x3 = Math.min(W - 1, x + 1);
      tmp[yW + x] = (gray[yW + x1] + 2 * gray[yW + x] + gray[yW + x3]) * 0.25;
    }
  }

  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - 1) * W;
    const y3 = Math.min(H - 1, y + 1) * W;
    const yW = y * W;
    for (let x = 0; x < W; x++) {
      out[yW + x] = (tmp[y1 + x] + 2 * tmp[yW + x] + tmp[y3 + x]) * 0.25;
    }
  }
  return out;
}

export function enhanceDocumentImage(
  inputCanvas: HTMLCanvasElement,
  mode: ScanFilterMode
): HTMLCanvasElement {
  if (mode === 'original') {
    return inputCanvas;
  }

  const W = inputCanvas.width;
  const H = inputCanvas.height;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = W;
  outputCanvas.height = H;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) return inputCanvas;

  ctx.drawImage(inputCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, W, H);
  const px = imageData.data;

  // Split into R, G, B channels
  const Rc = new Float32Array(W * H);
  const Gc = new Float32Array(W * H);
  const Bc = new Float32Array(W * H);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    Rc[p] = px[i];
    Gc[p] = px[i + 1];
    Bc[p] = px[i + 2];
  }

  // Large background window to estimate illumination & shadows
  const bgWin = Math.max(35, Math.floor(Math.min(W, H) / 9) | 1);
  const bgR = boxBlurChannel(Rc, W, H, bgWin);
  const bgG = boxBlurChannel(Gc, W, H, bgWin);
  const bgB = boxBlurChannel(Bc, W, H, bgWin);

  // Background illumination normalization
  const normR = new Float32Array(W * H);
  const normG = new Float32Array(W * H);
  const normB = new Float32Array(W * H);

  for (let i = 0; i < W * H; i++) {
    const br = Math.max(5, bgR[i]);
    const bg = Math.max(5, bgG[i]);
    const bb = Math.max(5, bgB[i]);

    let r = (Rc[i] / br) * 255;
    let g = (Gc[i] / bg) * 255;
    let b = (Bc[i] / bb) * 255;

    normR[i] = Math.min(255, Math.max(0, r));
    normG[i] = Math.min(255, Math.max(0, g));
    normB[i] = Math.min(255, Math.max(0, b));
  }

  // Calculate Luminance & Unsharp Mask sharpening
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    lum[i] = 0.299 * normR[i] + 0.587 * normG[i] + 0.114 * normB[i];
  }

  const lumBlur = gaussianBlur3x3(lum, W, H);
  const lumSharp = new Float32Array(W * H);
  const SHARP_AMOUNT = 1.35;

  for (let i = 0; i < W * H; i++) {
    let s = lum[i] + SHARP_AMOUNT * (lum[i] - lumBlur[i]);
    s = (s - 128) * 1.16 + 128 + 6;
    lumSharp[i] = Math.min(255, Math.max(0, s));
  }

  if (mode === 'color') {
    // Magic Color: Enhance ink saturation and sharpen text, whitening background
    const SATURATION = 1.2;
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const dLum = lumSharp[p] - lum[p];
      let r = normR[p] + dLum;
      let g = normG[p] + dLum;
      let b = normB[p] + dLum;

      const avg = (r + g + b) / 3;
      r = avg + (r - avg) * SATURATION;
      g = avg + (g - avg) * SATURATION;
      b = avg + (b - avg) * SATURATION;

      px[i] = Math.min(255, Math.max(0, r));
      px[i + 1] = Math.min(255, Math.max(0, g));
      px[i + 2] = Math.min(255, Math.max(0, b));
      px[i + 3] = 255;
    }
  } else if (mode === 'bw') {
    // Black & White: High clarity document binarization with local threshold
    const localWin = Math.max(15, Math.floor(Math.min(W, H) / 25) | 1);
    const localMean = boxBlurChannel(lumSharp, W, H, localWin);

    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const thresh = localMean[p] - 12;
      const val = lumSharp[p] < thresh ? 10 : 255;
      px[i] = val;
      px[i + 1] = val;
      px[i + 2] = val;
      px[i + 3] = 255;
    }
  } else if (mode === 'grayscale') {
    // Grayscale
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const val = lumSharp[p];
      px[i] = val;
      px[i + 1] = val;
      px[i + 2] = val;
      px[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return outputCanvas;
}
