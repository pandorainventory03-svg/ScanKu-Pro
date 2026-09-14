import { Point, QuadCorners, DetectionResult } from '../types';

/**
 * Advanced Document Boundary & Corner Detector
 * Specially engineered for:
 * 1. High contrast (e.g. white paper on dark wood/table)
 * 2. Identical/Same color (e.g. WHITE paper on WHITE desk/marble/laminate)
 * 
 * Employs:
 * - Multi-Spectral Color Opponency (Luminance + Yellow-Blue + Red-Green + Saturation)
 * - Micro-Shadow / Relief Filter (Difference of Gaussians for paper edge drop-shadows)
 * - Document Core Text/Graphic Detection (hard boundary prior preventing text mistaking)
 * - Directional Line Integral Projection (extracts faint linear paper edges across 100+ pixels)
 * - Perimeter-Inward Ray Scanning with Adaptive Low-Contrast Thresholds
 * - Robust RANSAC 4-Side Line Fitting & Precise Corner Intersection
 * - Geometric Aspect-Ratio & Perspective Plausibility Scoring
 */

// 3x3 Separable Gaussian Blur
function gaussianBlur3x3(gray: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const yw = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      tmp[yw + x] = (gray[yw + x0] + 2 * gray[yw + x] + gray[yw + x1]) * 0.25;
    }
  }

  for (let y = 0; y < h; y++) {
    const y0w = Math.max(0, y - 1) * w;
    const y1w = Math.min(h - 1, y + 1) * w;
    const yw = y * w;
    for (let x = 0; x < w; x++) {
      out[yw + x] = (tmp[y0w + x] + 2 * tmp[yw + x] + tmp[y1w + x]) * 0.25;
    }
  }
  return out;
}

// 5x5 Gaussian Blur for large scale smoothing
function gaussianBlur5x5(gray: Float32Array, w: number, h: number): Float32Array {
  return gaussianBlur3x3(gaussianBlur3x3(gray, w, h), w, h);
}

// Multi-spectral gradient output
interface MultiSpectralGradients {
  mag: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  maxMag: number;
  avgMag: number;
  shadowRelief: Float32Array;
  gray: Float32Array;
  isSameColorDesk: boolean;
  bgLuminance: number;
}

/**
 * Computes fused multi-spectral gradients combining:
 * 1. Grayscale luminance
 * 2. Opponent color channels (Yellow-Blue & Red-Green) - crucial for white paper on white desk
 * 3. Color saturation differences
 * 4. Micro-shadow relief (cast shadow from paper cut edge)
 */
function computeMultiSpectralGradients(
  px: Uint8ClampedArray,
  w: number,
  h: number
): MultiSpectralGradients {
  const total = w * h;
  const gray = new Float32Array(total);
  const oppYB = new Float32Array(total); // Yellow-Blue opponent
  const oppRG = new Float32Array(total); // Red-Green opponent
  const sat = new Float32Array(total);

  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = lum;
    oppYB[p] = (r + g) * 0.5 - b;
    oppRG[p] = r - g;
    sat[p] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  // Blurring for noise suppression
  const blurredLum = gaussianBlur3x3(gray, w, h);
  const blurredLarge = gaussianBlur5x5(gray, w, h);
  const blurredYB = gaussianBlur3x3(oppYB, w, h);
  const blurredRG = gaussianBlur3x3(oppRG, w, h);
  const blurredSat = gaussianBlur3x3(sat, w, h);

  // Micro-shadow filter (Difference of Gaussians / dark ridge along paper boundary)
  const shadowRelief = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    // A dark groove/shadow along the edge will have blurredLarge > blurredLum
    shadowRelief[i] = Math.max(0, blurredLarge[i] - blurredLum[i]);
  }

  // Estimate desk luminance from outer 5% margin corners
  const marginW = Math.max(3, Math.round(w * 0.05));
  const marginH = Math.max(3, Math.round(h * 0.05));
  let bgSum = 0;
  let bgCount = 0;
  for (let y = 0; y < marginH; y++) {
    for (let x = 0; x < marginW; x++) {
      bgSum += blurredLum[y * w + x];
      bgSum += blurredLum[y * w + (w - 1 - x)];
      bgSum += blurredLum[(h - 1 - y) * w + x];
      bgSum += blurredLum[(h - 1 - y) * w + (w - 1 - x)];
      bgCount += 4;
    }
  }
  const bgLuminance = bgSum / (bgCount || 1);

  // Estimate center luminance (likely document)
  const cx0 = Math.round(w * 0.35);
  const cx1 = Math.round(w * 0.65);
  const cy0 = Math.round(h * 0.35);
  const cy1 = Math.round(h * 0.65);
  let centerSum = 0;
  let centerCount = 0;
  for (let y = cy0; y < cy1; y += 2) {
    for (let x = cx0; x < cx1; x += 2) {
      centerSum += blurredLum[y * w + x];
      centerCount++;
    }
  }
  const centerLuminance = centerSum / (centerCount || 1);
  const isSameColorDesk = Math.abs(centerLuminance - bgLuminance) < 26;

  // Sobel convolution on all channels
  const mag = new Float32Array(total);
  const gx = new Float32Array(total);
  const gy = new Float32Array(total);

  let maxMag = 0;
  let sumMag = 0;

  for (let y = 1; y < h - 1; y++) {
    const yw = y * w;
    const yprev = (y - 1) * w;
    const ynext = (y + 1) * w;

    for (let x = 1; x < w - 1; x++) {
      const xprev = x - 1;
      const xnext = x + 1;

      // Luminance gradients
      const gxL =
        -blurredLum[yprev + xprev] - 2 * blurredLum[yw + xprev] - blurredLum[ynext + xprev] +
        blurredLum[yprev + xnext] + 2 * blurredLum[yw + xnext] + blurredLum[ynext + xnext];
      const gyL =
        -blurredLum[yprev + xprev] - 2 * blurredLum[yprev + x] - blurredLum[yprev + xnext] +
        blurredLum[ynext + xprev] + 2 * blurredLum[ynext + x] + blurredLum[ynext + xnext];

      // Yellow-Blue gradients (great for detecting fluorescent paper vs warm table)
      const gxYB =
        -blurredYB[yprev + xprev] - 2 * blurredYB[yw + xprev] - blurredYB[ynext + xprev] +
        blurredYB[yprev + xnext] + 2 * blurredYB[yw + xnext] + blurredYB[ynext + xnext];
      const gyYB =
        -blurredYB[yprev + xprev] - 2 * blurredYB[yprev + x] - blurredYB[yprev + xnext] +
        blurredYB[ynext + xprev] + 2 * blurredYB[ynext + x] + blurredYB[ynext + xnext];

      // Red-Green gradients
      const gxRG =
        -blurredRG[yprev + xprev] - 2 * blurredRG[yw + xprev] - blurredRG[ynext + xprev] +
        blurredRG[yprev + xnext] + 2 * blurredRG[yw + xnext] + blurredRG[ynext + xnext];
      const gyRG =
        -blurredRG[yprev + xprev] - 2 * blurredRG[yprev + x] - blurredRG[yprev + xnext] +
        blurredRG[ynext + xprev] + 2 * blurredRG[ynext + x] + blurredRG[ynext + xnext];

      // Saturation gradients
      const gxS =
        -blurredSat[yprev + xprev] - 2 * blurredSat[yw + xprev] - blurredSat[ynext + xprev] +
        blurredSat[yprev + xnext] + 2 * blurredSat[yw + xnext] + blurredSat[ynext + xnext];
      const gyS =
        -blurredSat[yprev + xprev] - 2 * blurredSat[yprev + x] - blurredSat[yprev + xnext] +
        blurredSat[ynext + xprev] + 2 * blurredSat[ynext + x] + blurredSat[ynext + xnext];

      // Shadow relief gradient
      const shadowVal = shadowRelief[yw + x];

      // Fused multi-channel gradients:
      // When paper and desk are same color, color-opponency + shadow relief are amplified!
      const wYB = isSameColorDesk ? 1.6 : 0.8;
      const wRG = isSameColorDesk ? 1.0 : 0.5;
      const wSat = isSameColorDesk ? 1.4 : 0.6;
      const wShad = isSameColorDesk ? 2.5 : 1.2;

      const totalGx = gxL + gxYB * wYB + gxRG * wRG + gxS * wSat;
      const totalGy = gyL + gyYB * wYB + gyRG * wRG + gyS * wSat;

      const m = Math.sqrt(totalGx * totalGx + totalGy * totalGy) + shadowVal * wShad;

      const idx = yw + x;
      mag[idx] = m;
      gx[idx] = totalGx;
      gy[idx] = totalGy;

      if (m > maxMag) maxMag = m;
      sumMag += m;
    }
  }

  return {
    mag,
    gx,
    gy,
    maxMag,
    avgMag: sumMag / total,
    shadowRelief,
    gray: blurredLum,
    isSameColorDesk,
    bgLuminance,
  };
}

// 2D Cross product
function crossProduct(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Monotone Chain algorithm for 2D Convex Hull
function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points.slice();

  const sorted = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Calculate polygon area using Shoelace formula
export function calculateQuadArea(c: QuadCorners): number {
  const { tl, tr, br, bl } = c;
  return Math.abs(
    (tl.x * tr.y - tr.x * tl.y) +
    (tr.x * br.y - tr.x * br.y + tr.x * br.y - tr.y * br.x) + // defensive
    (br.x * bl.y - bl.x * br.y) +
    (bl.x * tl.y - tl.x * bl.y)
  ) / 2 || Math.abs(
    (tl.x * (tr.y - bl.y) + tr.x * (br.y - tl.y) + br.x * (bl.y - tr.y) + bl.x * (tl.y - br.y)) / 2
  );
}

// Check if 4 points form a strictly convex quadrilateral
export function isConvexQuad(tl: Point, tr: Point, br: Point, bl: Point): boolean {
  const pts = [tl, tr, br, bl];
  let sign: number | null = null;
  for (let i = 0; i < 4; i++) {
    const o = pts[i];
    const a = pts[(i + 1) % 4];
    const b = pts[(i + 2) % 4];
    const cp = crossProduct(o, a, b);
    if (Math.abs(cp) < 1e-4) return false;
    const currentSign = cp > 0 ? 1 : -1;
    if (sign === null) sign = currentSign;
    else if (sign !== currentSign) return false;
  }
  return true;
}

// Order 4 points into { tl, tr, br, bl }
export function orderCorners(points: Point[]): QuadCorners {
  if (points.length !== 4) {
    throw new Error("orderCorners requires exactly 4 points");
  }

  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;

  const sortedByAngle = points.slice().sort((a, b) => {
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    return angA - angB;
  });

  let bestTlIndex = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const sum = sortedByAngle[i].x + sortedByAngle[i].y;
    if (sum < minSum) {
      minSum = sum;
      bestTlIndex = i;
    }
  }

  const tl = sortedByAngle[bestTlIndex];
  const tr = sortedByAngle[(bestTlIndex + 1) % 4];
  const br = sortedByAngle[(bestTlIndex + 2) % 4];
  const bl = sortedByAngle[(bestTlIndex + 3) % 4];

  if (tr.x < bl.x && tr.y > bl.y) {
    return {
      tl,
      tr: sortedByAngle[(bestTlIndex + 3) % 4],
      br: sortedByAngle[(bestTlIndex + 2) % 4],
      bl: sortedByAngle[(bestTlIndex + 1) % 4]
    };
  }

  return { tl, tr, br, bl };
}

// Generate default clean document corners
export function getDefaultCorners(w: number, h: number, margin = 0.08): QuadCorners {
  return {
    tl: { x: Math.round(w * margin), y: Math.round(h * margin) },
    tr: { x: Math.round(w * (1 - margin)), y: Math.round(h * margin) },
    br: { x: Math.round(w * (1 - margin)), y: Math.round(h * (1 - margin)) },
    bl: { x: Math.round(w * margin), y: Math.round(h * (1 - margin)) },
  };
}

/**
 * Robust RANSAC Linear Model for finding paper side lines
 */
interface FittedLine {
  m: number;
  c: number;
  isVertical: boolean;
  inliersCount: number;
}

function fitLineRANSAC(points: Point[], isVertical: boolean, maxDist = 3.5): FittedLine | null {
  if (points.length < 5) return null;

  let bestInliers: Point[] = [];
  let bestM = 0;
  let bestC = 0;
  const iterations = Math.min(50, points.length * 2);

  for (let it = 0; it < iterations; it++) {
    const idx1 = Math.floor(Math.random() * points.length);
    let idx2 = Math.floor(Math.random() * points.length);
    if (idx1 === idx2) idx2 = (idx1 + 1) % points.length;

    const p1 = points[idx1];
    const p2 = points[idx2];

    let m = 0;
    let c = 0;

    if (isVertical) {
      const dy = p2.y - p1.y;
      if (Math.abs(dy) < 4) continue;
      m = (p2.x - p1.x) / dy;
      if (Math.abs(m) > 0.85) continue;
      c = p1.x - m * p1.y;
    } else {
      const dx = p2.x - p1.x;
      if (Math.abs(dx) < 4) continue;
      m = (p2.y - p1.y) / dx;
      if (Math.abs(m) > 0.85) continue;
      c = p1.y - m * p1.x;
    }

    const inliers: Point[] = [];
    for (const p of points) {
      const dist = isVertical
        ? Math.abs(p.x - (m * p.y + c)) / Math.sqrt(1 + m * m)
        : Math.abs(p.y - (m * p.x + c)) / Math.sqrt(1 + m * m);
      if (dist <= maxDist) {
        inliers.push(p);
      }
    }

    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestM = m;
      bestC = c;
    }
  }

  if (bestInliers.length < 5) return null;

  // Least-Squares Refinement on inliers
  let sumU = 0, sumV = 0, sumU2 = 0, sumUV = 0;
  const n = bestInliers.length;
  for (const p of bestInliers) {
    const u = isVertical ? p.y : p.x;
    const v = isVertical ? p.x : p.y;
    sumU += u;
    sumV += v;
    sumU2 += u * u;
    sumUV += u * v;
  }

  const denom = n * sumU2 - sumU * sumU;
  if (Math.abs(denom) > 1e-5) {
    bestM = (n * sumUV - sumU * sumV) / denom;
    bestC = (sumV - bestM * sumU) / n;
  }

  return {
    m: bestM,
    c: bestC,
    isVertical,
    inliersCount: bestInliers.length,
  };
}

// Compute intersection of horizontal (y = m1*x + c1) and vertical (x = m2*y + c2) line
function intersectHV(hLine: FittedLine, vLine: FittedLine): Point {
  const mt = hLine.m;
  const ct = hLine.c;
  const ml = vLine.m;
  const cl = vLine.c;

  const denom = 1 - mt * ml;
  const safeDenom = Math.abs(denom) < 1e-4 ? (denom >= 0 ? 1e-4 : -1e-4) : denom;
  const y = (mt * cl + ct) / safeDenom;
  const x = ml * y + cl;
  return { x, y };
}

/**
 * Document Content Box Prior:
 * Detects the bounding rectangle of text, headings, or graphics inside the document.
 * The physical paper edge MUST be outside this content box!
 */
interface ContentCore {
  hasContent: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  areaPercent: number;
}

function detectDocumentCore(
  gradients: MultiSpectralGradients,
  w: number,
  h: number
): ContentCore {
  const { mag, gray, isSameColorDesk } = gradients;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  let contentCount = 0;

  // Content threshold: text produces high local gradients (> 35) or dark contrast against white
  const highGradThresh = Math.max(30, gradients.maxMag * 0.22);
  const minMarginX = Math.round(w * 0.04);
  const minMarginY = Math.round(h * 0.04);

  for (let y = minMarginY; y < h - minMarginY; y += 3) {
    const yw = y * w;
    for (let x = minMarginX; x < w - minMarginX; x += 3) {
      const idx = yw + x;
      const m = mag[idx];
      const g = gray[idx];

      // Check for ink / text on paper
      const isInk = isSameColorDesk ? (m > highGradThresh || (g < 140 && m > 20)) : (m > highGradThresh);

      if (isInk) {
        contentCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const hasContent = contentCount > 30 && maxX > minX + 20 && maxY > minY + 20;
  const areaPercent = hasContent ? ((maxX - minX) * (maxY - minY)) / (w * h) : 0;

  return {
    hasContent,
    minX: Math.max(0, minX),
    maxX: Math.min(w, maxX),
    minY: Math.max(0, minY),
    maxY: Math.min(h, maxY),
    areaPercent,
  };
}

/**
 * Integral Line Projection Profiler:
 * For detecting very faint straight lines across the entire document width/height.
 * Even if single-pixel contrast is only 4-8 units, summing across 100+ pixels produces a sharp spike!
 */
function findIntegralLinePeaks(
  gradients: MultiSpectralGradients,
  w: number,
  h: number,
  core: ContentCore
): { topY: number; botY: number; leftX: number; rightX: number } {
  const { mag, gy, gx } = gradients;

  // Boundaries for searching each side
  const topLimit = core.hasContent ? Math.max(4, core.minY - 2) : Math.round(h * 0.6);
  const botLimit = core.hasContent ? Math.min(h - 4, core.maxY + 2) : Math.round(h * 0.4);
  const leftLimit = core.hasContent ? Math.max(4, core.minX - 2) : Math.round(w * 0.6);
  const rightLimit = core.hasContent ? Math.min(w - 4, core.maxX + 2) : Math.round(w * 0.4);

  // 1. Top Edge Search: Scan lines y from 4 to topLimit
  let bestTopScore = -1;
  let bestTopY = Math.round(h * 0.08);
  const xSpanStart = Math.round(w * 0.15);
  const xSpanEnd = Math.round(w * 0.85);

  for (let y = 3; y < topLimit; y++) {
    let sum = 0;
    const yw = y * w;
    for (let x = xSpanStart; x < xSpanEnd; x += 2) {
      const idx = yw + x;
      // Perpendicular gradient (gy) + total magnitude
      sum += Math.abs(gy[idx]) * 0.7 + mag[idx] * 0.3;
    }
    const score = sum / ((xSpanEnd - xSpanStart) / 2);
    if (score > bestTopScore) {
      bestTopScore = score;
      bestTopY = y;
    }
  }

  // 2. Bottom Edge Search: Scan lines y from h-4 down to botLimit
  let bestBotScore = -1;
  let bestBotY = Math.round(h * 0.92);
  for (let y = h - 4; y > botLimit; y--) {
    let sum = 0;
    const yw = y * w;
    for (let x = xSpanStart; x < xSpanEnd; x += 2) {
      const idx = yw + x;
      sum += Math.abs(gy[idx]) * 0.7 + mag[idx] * 0.3;
    }
    const score = sum / ((xSpanEnd - xSpanStart) / 2);
    if (score > bestBotScore) {
      bestBotScore = score;
      bestBotY = y;
    }
  }

  // 3. Left Edge Search: Scan lines x from 4 to leftLimit
  let bestLeftScore = -1;
  let bestLeftX = Math.round(w * 0.08);
  const ySpanStart = Math.round(h * 0.15);
  const ySpanEnd = Math.round(h * 0.85);

  for (let x = 3; x < leftLimit; x++) {
    let sum = 0;
    for (let y = ySpanStart; y < ySpanEnd; y += 2) {
      const idx = y * w + x;
      sum += Math.abs(gx[idx]) * 0.7 + mag[idx] * 0.3;
    }
    const score = sum / ((ySpanEnd - ySpanStart) / 2);
    if (score > bestLeftScore) {
      bestLeftScore = score;
      bestLeftX = x;
    }
  }

  // 4. Right Edge Search: Scan lines x from w-4 down to rightLimit
  let bestRightScore = -1;
  let bestRightX = Math.round(w * 0.92);
  for (let x = w - 4; x > rightLimit; x--) {
    let sum = 0;
    for (let y = ySpanStart; y < ySpanEnd; y += 2) {
      const idx = y * w + x;
      sum += Math.abs(gx[idx]) * 0.7 + mag[idx] * 0.3;
    }
    const score = sum / ((ySpanEnd - ySpanStart) / 2);
    if (score > bestRightScore) {
      bestRightScore = score;
      bestRightX = x;
    }
  }

  return {
    topY: bestTopY,
    botY: bestBotY,
    leftX: bestLeftX,
    rightX: bestRightX,
  };
}

/**
 * Score candidate quad by evaluating:
 * 1. Multi-spectral edge alignment along its 4 perimeter segments
 * 2. Parallelism of opposite sides (top/bot and left/right)
 * 3. Aspect ratio sanity (standard paper ratio 1.15 to 2.2)
 * 4. Content enclosure (quad MUST enclose text/graphic content)
 */
function evaluateCandidateQuad(
  quad: QuadCorners,
  gradients: MultiSpectralGradients,
  w: number,
  h: number,
  core: ContentCore
): { score: number; avgGradient: number } {
  const { tl, tr, br, bl } = quad;
  const { mag, gx, gy } = gradients;

  // 1. Content Enclosure Check
  if (core.hasContent) {
    const margin = 2;
    if (
      tl.x > core.minX + margin || bl.x > core.minX + margin ||
      tr.x < core.maxX - margin || br.x < core.maxX - margin ||
      tl.y > core.minY + margin || tr.y > core.minY + margin ||
      bl.y < core.maxY - margin || br.y < core.maxY - margin
    ) {
      // Quad cuts inside text content! Heavily penalize
      return { score: -1, avgGradient: 0 };
    }
  }

  // 2. Opposite sides length ratio (perspective foreshortening sanity)
  const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const botLen = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftLen = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);

  if (topLen < 15 || botLen < 15 || leftLen < 15 || rightLen < 15) {
    return { score: -1, avgGradient: 0 };
  }

  const hRatio = Math.min(topLen, botLen) / Math.max(topLen, botLen);
  const vRatio = Math.min(leftLen, rightLen) / Math.max(leftLen, rightLen);
  if (hRatio < 0.55 || vRatio < 0.55) {
    return { score: -1, avgGradient: 0 }; // Too trapezoidal/distorted
  }

  // 3. Aspect Ratio check (Document aspect ratio is typically between 1.15 and 2.3)
  const avgWidth = (topLen + botLen) / 2;
  const avgHeight = (leftLen + rightLen) / 2;
  const aspect = Math.max(avgWidth, avgHeight) / Math.min(avgWidth, avgHeight);
  let aspectBonus = 1.0;
  if (aspect >= 1.25 && aspect <= 1.65) {
    aspectBonus = 1.25; // Standard A4 / Letter / Legal
  } else if (aspect > 2.5) {
    aspectBonus = 0.7; // Very elongated
  }

  // 4. Sample edge gradients along all 4 sides
  const sides = [
    { from: tl, to: tr, isHoriz: true },
    { from: tr, to: br, isHoriz: false },
    { from: br, to: bl, isHoriz: true },
    { from: bl, to: tl, isHoriz: false },
  ];

  let totalEdgeVal = 0;
  const SAMPLES = 28;

  for (const side of sides) {
    const dx = side.to.x - side.from.x;
    const dy = side.to.y - side.from.y;

    for (let s = 1; s <= SAMPLES; s++) {
      const t = s / (SAMPLES + 1);
      const px = Math.round(side.from.x + dx * t);
      const py = Math.round(side.from.y + dy * t);

      if (px >= 1 && px < w - 1 && py >= 1 && py < h - 1) {
        const idx = py * w + px;
        const magVal = mag[idx];
        const dirVal = side.isHoriz ? Math.abs(gy[idx]) : Math.abs(gx[idx]);
        totalEdgeVal += magVal * 0.45 + dirVal * 0.55;
      }
    }
  }

  const avgGradient = totalEdgeVal / (sides.length * SAMPLES);
  const geomScore = (hRatio * 0.5 + vRatio * 0.5) * aspectBonus;

  return {
    score: avgGradient * (0.5 + 0.5 * geomScore),
    avgGradient,
  };
}

/**
 * Local Corner Snapping:
 * Refines corner coordinates by locating local gradient peaks in a small radius
 */
function refineCornersLocally(
  corners: QuadCorners,
  gradients: MultiSpectralGradients,
  w: number,
  h: number
): QuadCorners {
  const refined: QuadCorners = {
    tl: { ...corners.tl },
    tr: { ...corners.tr },
    br: { ...corners.br },
    bl: { ...corners.bl },
  };

  const keys: Array<keyof QuadCorners> = ['tl', 'tr', 'br', 'bl'];
  const R = 5;
  const minThresh = gradients.isSameColorDesk ? 5 : 15;

  for (const key of keys) {
    const pt = refined[key];
    let bestX = pt.x;
    let bestY = pt.y;
    let maxVal = -1;

    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = Math.round(pt.x + dx);
        const ny = Math.round(pt.y + dy);
        if (nx >= 2 && nx < w - 2 && ny >= 2 && ny < h - 2) {
          const val = gradients.mag[ny * w + nx];
          if (val > maxVal) {
            maxVal = val;
            bestX = nx;
            bestY = ny;
          }
        }
      }
    }

    if (maxVal > minThresh) {
      refined[key] = { x: bestX, y: bestY };
    }
  }

  return refined;
}

/**
 * Public helper: Snap any given quadrilateral corners to nearest physical edges
 * Accessible by user from CropEditor "Rapatkan" button.
 */
export function snapCornersToEdges(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  corners: QuadCorners,
  targetW: number,
  targetH: number
): QuadCorners {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return corners;

  ctx.drawImage(source, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const gradients = computeMultiSpectralGradients(imgData.data, targetW, targetH);

  return refineCornersLocally(corners, gradients, targetW, targetH);
}

/**
 * Main High-Precision Document Detection Algorithm:
 * Specially designed to detect paper boundaries even on tables of the SAME color (e.g. white on white desk).
 */
export function detectDocumentCorners(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetW: number,
  targetH: number
): DetectionResult {
  const origW = 'videoWidth' in source && source.videoWidth ? source.videoWidth :
                'naturalWidth' in source && source.naturalWidth ? source.naturalWidth :
                source.width || targetW;
  const origH = 'videoHeight' in source && source.videoHeight ? source.videoHeight :
                'naturalHeight' in source && source.naturalHeight ? source.naturalHeight :
                source.height || targetH;

  if (!origW || !origH) {
    const def = getDefaultCorners(targetW, targetH);
    return { corners: def, confidence: 20, isDocumentDetected: false, areaPercent: 0.8 };
  }

  // Work at ~340px for ideal balance of high speed (<14ms) and micro-edge precision
  const maxDim = 340;
  const scale = Math.min(maxDim / origW, maxDim / origH, 1);
  const workW = Math.max(60, Math.round(origW * scale));
  const workH = Math.max(60, Math.round(origH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    const def = getDefaultCorners(targetW, targetH);
    return { corners: def, confidence: 20, isDocumentDetected: false, areaPercent: 0.8 };
  }

  ctx.drawImage(source, 0, 0, workW, workH);
  const imgData = ctx.getImageData(0, 0, workW, workH);

  // 1. Compute Multi-Spectral Fused Gradients (Luminance, Opponency, Saturation, Micro-Shadows)
  const gradients = computeMultiSpectralGradients(imgData.data, workW, workH);

  if (gradients.maxMag < 6) {
    const def = getDefaultCorners(targetW, targetH);
    return { corners: def, confidence: 20, isDocumentDetected: false, areaPercent: 0.8 };
  }

  // 2. Detect Document Text/Graphic Core
  const core = detectDocumentCore(gradients, workW, workH);

  // 3. Adaptive Edge Threshold for paper boundary
  // On same-color tables, allow much lower gradients (e.g. 5-10) for paper rims and micro-shadows!
  const isSameColor = gradients.isSameColorDesk;
  const edgeThreshold = isSameColor
    ? Math.max(5.5, Math.min(14, gradients.maxMag * 0.08))
    : Math.max(12, gradients.maxMag * 0.16);

  // 4. STRATEGY A: Perimeter-Inward Ray Scanning (Detects the 4 physical sides)
  const topPoints: Point[] = [];
  const bottomPoints: Point[] = [];
  const leftPoints: Point[] = [];
  const rightPoints: Point[] = [];

  const startX = Math.round(workW * 0.04);
  const endX = Math.round(workW * 0.96);
  const startY = Math.round(workH * 0.04);
  const endY = Math.round(workH * 0.96);

  const topScanMax = core.hasContent ? Math.min(Math.round(workH * 0.65), core.minY + 4) : Math.round(workH * 0.65);
  const botScanMin = core.hasContent ? Math.max(Math.round(workH * 0.35), core.maxY - 4) : Math.round(workH * 0.35);
  const leftScanMax = core.hasContent ? Math.min(Math.round(workW * 0.65), core.minX + 4) : Math.round(workW * 0.65);
  const rightScanMin = core.hasContent ? Math.max(Math.round(workW * 0.35), core.maxX - 4) : Math.round(workW * 0.35);

  // Top Edge Scan (Scan downwards from top)
  for (let x = startX; x < endX; x += 3) {
    let prevMag = 0;
    for (let y = Math.round(workH * 0.02); y < topScanMax; y++) {
      const idx = y * workW + x;
      const mag = gradients.mag[idx];
      const gyAbs = Math.abs(gradients.gy[idx]);
      const shadow = gradients.shadowRelief[idx];

      // Detect edge peak: directional gradient + local peak or micro-shadow
      const isPeak = mag > prevMag && mag > edgeThreshold && (gyAbs > edgeThreshold * 0.7 || shadow > 1.0);
      prevMag = mag;

      if (isPeak) {
        topPoints.push({ x, y });
        break;
      }
    }
  }

  // Bottom Edge Scan (Scan upwards from bottom)
  for (let x = startX; x < endX; x += 3) {
    let prevMag = 0;
    for (let y = Math.round(workH * 0.98); y > botScanMin; y--) {
      const idx = y * workW + x;
      const mag = gradients.mag[idx];
      const gyAbs = Math.abs(gradients.gy[idx]);
      const shadow = gradients.shadowRelief[idx];

      const isPeak = mag > prevMag && mag > edgeThreshold && (gyAbs > edgeThreshold * 0.7 || shadow > 1.0);
      prevMag = mag;

      if (isPeak) {
        bottomPoints.push({ x, y });
        break;
      }
    }
  }

  // Left Edge Scan (Scan rightwards from left)
  for (let y = startY; y < endY; y += 3) {
    let prevMag = 0;
    for (let x = Math.round(workW * 0.02); x < leftScanMax; x++) {
      const idx = y * workW + x;
      const mag = gradients.mag[idx];
      const gxAbs = Math.abs(gradients.gx[idx]);
      const shadow = gradients.shadowRelief[idx];

      const isPeak = mag > prevMag && mag > edgeThreshold && (gxAbs > edgeThreshold * 0.7 || shadow > 1.0);
      prevMag = mag;

      if (isPeak) {
        leftPoints.push({ x, y });
        break;
      }
    }
  }

  // Right Edge Scan (Scan leftwards from right)
  for (let y = startY; y < endY; y += 3) {
    let prevMag = 0;
    for (let x = Math.round(workW * 0.98); x > rightScanMin; x--) {
      const idx = y * workW + x;
      const mag = gradients.mag[idx];
      const gxAbs = Math.abs(gradients.gx[idx]);
      const shadow = gradients.shadowRelief[idx];

      const isPeak = mag > prevMag && mag > edgeThreshold && (gxAbs > edgeThreshold * 0.7 || shadow > 1.0);
      prevMag = mag;

      if (isPeak) {
        rightPoints.push({ x, y });
        break;
      }
    }
  }

  const candidateQuads: QuadCorners[] = [];

  // 5. Fit 4 sides using RANSAC and find corner intersections
  const topLine = fitLineRANSAC(topPoints, false);
  const bottomLine = fitLineRANSAC(bottomPoints, false);
  const leftLine = fitLineRANSAC(leftPoints, true);
  const rightLine = fitLineRANSAC(rightPoints, true);

  if (topLine && bottomLine && leftLine && rightLine) {
    const tl = intersectHV(topLine, leftLine);
    const tr = intersectHV(topLine, rightLine);
    const br = intersectHV(bottomLine, rightLine);
    const bl = intersectHV(bottomLine, leftLine);

    const pad = Math.max(workW, workH) * 0.08;
    const inBounds = (p: Point) => p.x >= -pad && p.x <= workW + pad && p.y >= -pad && p.y <= workH + pad;

    if (inBounds(tl) && inBounds(tr) && inBounds(br) && inBounds(bl)) {
      if (isConvexQuad(tl, tr, br, bl)) {
        candidateQuads.push({
          tl: { x: Math.max(0, Math.min(workW, tl.x)), y: Math.max(0, Math.min(workH, tl.y)) },
          tr: { x: Math.max(0, Math.min(workW, tr.x)), y: Math.max(0, Math.min(workH, tr.y)) },
          br: { x: Math.max(0, Math.min(workW, br.x)), y: Math.max(0, Math.min(workH, br.y)) },
          bl: { x: Math.max(0, Math.min(workW, bl.x)), y: Math.max(0, Math.min(workH, bl.y)) },
        });
      }
    }
  }

  // 6. STRATEGY B: Integral Line Projection Peaks (Extraordinary for same-color white desk!)
  const peaks = findIntegralLinePeaks(gradients, workW, workH, core);
  if (peaks.botY > peaks.topY + 30 && peaks.rightX > peaks.leftX + 30) {
    const peakQuad: QuadCorners = {
      tl: { x: peaks.leftX, y: peaks.topY },
      tr: { x: peaks.rightX, y: peaks.topY },
      br: { x: peaks.rightX, y: peaks.botY },
      bl: { x: peaks.leftX, y: peaks.botY },
    };
    if (isConvexQuad(peakQuad.tl, peakQuad.tr, peakQuad.br, peakQuad.bl)) {
      candidateQuads.push(peakQuad);
    }
  }

  // 7. STRATEGY C: All Edge Points Convex Hull Simplification
  const allPoints = [...topPoints, ...bottomPoints, ...leftPoints, ...rightPoints];
  if (allPoints.length >= 14) {
    const hull = convexHull(allPoints);
    if (hull.length >= 4) {
      let maxArea = 0;
      let bestHullQuad: QuadCorners | null = null;
      const step = Math.max(1, Math.floor(hull.length / 14));

      for (let i = 0; i < hull.length; i += step) {
        for (let j = (i + 1) % hull.length; j !== i; j = (j + step) % hull.length) {
          for (let k = (j + 1) % hull.length; k !== i && k !== j; k = (k + step) % hull.length) {
            for (let m = (k + 1) % hull.length; m !== i && m !== j && m !== k; m = (m + step) % hull.length) {
              try {
                const q = orderCorners([hull[i], hull[j], hull[k], hull[m]]);
                if (isConvexQuad(q.tl, q.tr, q.br, q.bl)) {
                  const area = calculateQuadArea(q);
                  if (area > maxArea) {
                    maxArea = area;
                    bestHullQuad = q;
                  }
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }

      if (bestHullQuad) {
        candidateQuads.push(bestHullQuad);
      }
    }
  }

  // 8. STRATEGY D: Content Core with Standard Paper Margin
  // If text is detected but edges are very faint, expand the text core with standard document margins
  if (core.hasContent && core.areaPercent > 0.08) {
    const marginRatioX = 0.12; // ~12% side margin
    const marginRatioY = 0.14; // ~14% top/bottom margin
    const coreW = core.maxX - core.minX;
    const coreH = core.maxY - core.minY;

    const paperMinX = Math.max(Math.round(workW * 0.04), Math.round(core.minX - coreW * marginRatioX));
    const paperMaxX = Math.min(Math.round(workW * 0.96), Math.round(core.maxX + coreW * marginRatioX));
    const paperMinY = Math.max(Math.round(workH * 0.04), Math.round(core.minY - coreH * marginRatioY));
    const paperMaxY = Math.min(Math.round(workH * 0.96), Math.round(core.maxY + coreH * marginRatioY));

    const coreDerivedQuad: QuadCorners = {
      tl: { x: paperMinX, y: paperMinY },
      tr: { x: paperMaxX, y: paperMinY },
      br: { x: paperMaxX, y: paperMaxY },
      bl: { x: paperMinX, y: paperMaxY },
    };
    candidateQuads.push(coreDerivedQuad);
  }

  // 9. Multi-Criteria Evaluation and Selection of Best Quad
  let bestCorners: QuadCorners | null = null;
  let highestScore = -1;
  const workArea = workW * workH;

  for (const quad of candidateQuads) {
    const area = calculateQuadArea(quad);
    const areaPercent = area / workArea;

    if (areaPercent < 0.12 || areaPercent > 0.96) continue;

    const { score, avgGradient } = evaluateCandidateQuad(quad, gradients, workW, workH, core);
    if (score < 0) continue;

    // Favor candidates with strong edge alignment, reasonable area, and proper enclosure
    const totalScore = score * Math.sqrt(areaPercent);

    const minAvgGrad = isSameColor ? 5.0 : 9.0;
    if (totalScore > highestScore && avgGradient > minAvgGrad) {
      highestScore = totalScore;
      bestCorners = quad;
    }
  }

  // 10. Locally Refine Corners along physical micro-edges
  if (bestCorners) {
    bestCorners = refineCornersLocally(bestCorners, gradients, workW, workH);
  }

  // 11. Scale Corners to target dimensions targetW x targetH
  const scaleX = targetW / workW;
  const scaleY = targetH / workH;
  const targetArea = targetW * targetH;

  if (bestCorners && highestScore > 0) {
    const scaled: QuadCorners = {
      tl: { x: Math.max(0, Math.min(targetW, bestCorners.tl.x * scaleX)), y: Math.max(0, Math.min(targetH, bestCorners.tl.y * scaleY)) },
      tr: { x: Math.max(0, Math.min(targetW, bestCorners.tr.x * scaleX)), y: Math.max(0, Math.min(targetH, bestCorners.tr.y * scaleY)) },
      br: { x: Math.max(0, Math.min(targetW, bestCorners.br.x * scaleX)), y: Math.max(0, Math.min(targetH, bestCorners.br.y * scaleY)) },
      bl: { x: Math.max(0, Math.min(targetW, bestCorners.bl.x * scaleX)), y: Math.max(0, Math.min(targetH, bestCorners.bl.y * scaleY)) },
    };

    const finalArea = calculateQuadArea(scaled);
    const areaPercent = finalArea / targetArea;

    // Confidence metric
    const confidenceBase = isSameColor ? 72 : 65;
    const confidence = Math.min(98, Math.max(confidenceBase, Math.round(55 + highestScore * 0.8)));

    return {
      corners: scaled,
      confidence,
      isDocumentDetected: true,
      areaPercent,
    };
  }

  // Fallback: Return standard document margin corners
  const defCorners = getDefaultCorners(targetW, targetH, 0.08);
  return {
    corners: defCorners,
    confidence: 25,
    isDocumentDetected: false,
    areaPercent: calculateQuadArea(defCorners) / targetArea,
  };
}

/**
 * Temporal Smoothing filter for live camera tracking.
 * Smooths out jitter from frame-to-frame detection.
 */
export class CornerSmoother {
  private smoothed: QuadCorners | null = null;
  private readonly alpha: number;

  constructor(alpha = 0.4) {
    this.alpha = alpha;
  }

  public update(detected: QuadCorners, isDetected: boolean): QuadCorners {
    if (!this.smoothed || !isDetected) {
      this.smoothed = {
        tl: { ...detected.tl },
        tr: { ...detected.tr },
        br: { ...detected.br },
        bl: { ...detected.bl }
      };
      return this.smoothed;
    }

    // Check if detection jumped significantly (e.g. document moved quickly)
    const dTl = Math.hypot(detected.tl.x - this.smoothed.tl.x, detected.tl.y - this.smoothed.tl.y);
    const dBr = Math.hypot(detected.br.x - this.smoothed.br.x, detected.br.y - this.smoothed.br.y);
    if (dTl > 120 || dBr > 120) {
      this.smoothed = {
        tl: { ...detected.tl },
        tr: { ...detected.tr },
        br: { ...detected.br },
        bl: { ...detected.bl }
      };
      return this.smoothed;
    }

    const a = this.alpha;
    this.smoothed = {
      tl: {
        x: this.smoothed.tl.x * (1 - a) + detected.tl.x * a,
        y: this.smoothed.tl.y * (1 - a) + detected.tl.y * a
      },
      tr: {
        x: this.smoothed.tr.x * (1 - a) + detected.tr.x * a,
        y: this.smoothed.tr.y * (1 - a) + detected.tr.y * a
      },
      br: {
        x: this.smoothed.br.x * (1 - a) + detected.br.x * a,
        y: this.smoothed.br.y * (1 - a) + detected.br.y * a
      },
      bl: {
        x: this.smoothed.bl.x * (1 - a) + detected.bl.x * a,
        y: this.smoothed.bl.y * (1 - a) + detected.bl.y * a
      }
    };

    return this.smoothed;
  }

  public reset(): void {
    this.smoothed = null;
  }
}
