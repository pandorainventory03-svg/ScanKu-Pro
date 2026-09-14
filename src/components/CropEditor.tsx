import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, Sparkles, Maximize2, MoveHorizontal, MoveVertical, Magnet } from 'lucide-react';
import { Point, QuadCorners } from '../types';
import { detectDocumentCorners, getDefaultCorners, snapCornersToEdges } from '../utils/documentDetector';
import { perspectiveTransform } from '../utils/perspectiveTransform';

interface CropEditorProps {
  imageSrc: string;
  initialCorners?: QuadCorners;
  onApply: (unwarpedCanvas: HTMLCanvasElement) => void;
  onCancel: () => void;
}

type SideKey = 'top' | 'right' | 'bottom' | 'left';

export const CropEditor: React.FC<CropEditorProps> = ({
  imageSrc,
  initialCorners,
  onApply,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [scale, setScale] = useState<number>(1);
  const [corners, setCorners] = useState<QuadCorners | null>(null);
  const [activeCornerKey, setActiveCornerKey] = useState<keyof QuadCorners | null>(null);
  const [activeSideKey, setActiveSideKey] = useState<SideKey | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [loupePos, setLoupePos] = useState<{ x: number; y: number } | null>(null);

  const dragStartSidePosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const dragStartCornersRef = useRef<QuadCorners | null>(null);

  // Setup display dimensions and initial corners
  const initCornersFromImage = useCallback((img: HTMLImageElement) => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const contW = container.clientWidth;
    const contH = container.clientHeight || 450;

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;

    const fitRatio = Math.min(contW / naturalW, contH / naturalH);
    const dispW = Math.round(naturalW * fitRatio);
    const dispH = Math.round(naturalH * fitRatio);

    setDisplaySize({ width: dispW, height: dispH });
    const s = dispW / naturalW;
    setScale(s);

    if (initialCorners) {
      // Scale passed corners to display coordinates
      setCorners({
        tl: { x: initialCorners.tl.x * s, y: initialCorners.tl.y * s },
        tr: { x: initialCorners.tr.x * s, y: initialCorners.tr.y * s },
        br: { x: initialCorners.br.x * s, y: initialCorners.br.y * s },
        bl: { x: initialCorners.bl.x * s, y: initialCorners.bl.y * s },
      });
    } else {
      // Try auto-detection on first open
      const det = detectDocumentCorners(img, dispW, dispH);
      if (det.isDocumentDetected) {
        setCorners(det.corners);
        setFeedbackMsg(`✨ Sisi kertas otomatis terdeteksi (${det.confidence}%)`);
        setTimeout(() => setFeedbackMsg(null), 3000);
      } else {
        setCorners(getDefaultCorners(dispW, dispH));
      }
    }
  }, [initialCorners]);

  useEffect(() => {
    const img = imageRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
      initCornersFromImage(img);
    }
  }, [initCornersFromImage]);

  // Handle image load
  const handleImageLoad = () => {
    if (imageRef.current) {
      setImageLoaded(true);
      initCornersFromImage(imageRef.current);
    }
  };

  // Run Auto Document Side & Corner Detection
  const handleAutoDetect = () => {
    if (!imageRef.current || !imageLoaded) return;
    setIsDetecting(true);

    setTimeout(() => {
      if (imageRef.current) {
        const det = detectDocumentCorners(imageRef.current, displaySize.width, displaySize.height);
        if (det.isDocumentDetected) {
          setCorners(det.corners);
          setFeedbackMsg(`✨ 4 Sisi kertas terdeteksi (${det.confidence}%)`);
        } else {
          setCorners(getDefaultCorners(displaySize.width, displaySize.height));
          setFeedbackMsg('ℹ️ Kontur kontras rendah, posisi disesuaikan ke margin.');
        }
        setTimeout(() => setFeedbackMsg(null), 3000);
      }
      setIsDetecting(false);
    }, 40);
  };

  // Snap current corners to nearest physical edges
  const handleSnapToEdges = () => {
    if (!imageRef.current || !corners || !imageLoaded) return;
    const snapped = snapCornersToEdges(imageRef.current, corners, displaySize.width, displaySize.height);
    setCorners(snapped);
    setFeedbackMsg('✨ Sisi kertas dirapatkan ke kontur terdekat');
    setTimeout(() => setFeedbackMsg(null), 2500);
  };

  // Reset to full view margin
  const handleResetToMargin = () => {
    setCorners(getDefaultCorners(displaySize.width, displaySize.height, 0.04));
    setFeedbackMsg('Sudut diatur ke seluruh halaman.');
    setTimeout(() => setFeedbackMsg(null), 2000);
  };

  // Draw Magnifier Loupe
  const updateLoupe = useCallback((point: Point) => {
    const canvas = loupeCanvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !scale) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 110;
    canvas.width = size;
    canvas.height = size;

    const zoom = 2.4;
    // Map point to original image coordinates
    const origX = point.x / scale;
    const origY = point.y / scale;

    ctx.clearRect(0, 0, size, size);

    // Circular clipping
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    // Draw magnified image segment
    const sourceW = size / zoom;
    const sourceH = size / zoom;
    const sx = Math.max(0, Math.min(img.naturalWidth - sourceW, origX - sourceW / 2));
    const sy = Math.max(0, Math.min(img.naturalHeight - sourceH, origY - sourceH / 2));

    ctx.drawImage(img, sx, sy, sourceW, sourceH, 0, 0, size, size);

    // Crosshair
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(size / 2 - 14, size / 2);
    ctx.lineTo(size / 2 + 14, size / 2);
    ctx.moveTo(size / 2, size / 2 - 14);
    ctx.lineTo(size / 2, size / 2 + 14);
    ctx.stroke();

    ctx.restore();

    // Outer ring
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }, [scale]);

  // Touch and Mouse pointer dragging
  const getContainerRelativePos = (clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(displaySize.width, clientX - rect.left)),
      y: Math.max(0, Math.min(displaySize.height, clientY - rect.top)),
    };
  };

  const handleCornerPointerDown = (key: keyof QuadCorners, e: React.PointerEvent | React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveCornerKey(key);
    setActiveSideKey(null);

    let clientX = 0, clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    if (corners) {
      const pt = corners[key];
      setLoupePos({ x: pt.x, y: pt.y - 75 });
      updateLoupe(pt);
    }
  };

  const handleSidePointerDown = (side: SideKey, e: React.PointerEvent | React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSideKey(side);
    setActiveCornerKey(null);

    let clientX = 0, clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    dragStartSidePosRef.current = { clientX, clientY };
    if (corners) {
      dragStartCornersRef.current = {
        tl: { ...corners.tl },
        tr: { ...corners.tr },
        br: { ...corners.br },
        bl: { ...corners.bl },
      };
    }
  };

  const handlePointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    let clientX = 0, clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }

    // Corner dragging
    if (activeCornerKey && corners) {
      const pos = getContainerRelativePos(clientX, clientY);

      setCorners((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [activeCornerKey]: pos,
        };
      });

      setLoupePos({
        x: Math.max(60, Math.min(displaySize.width - 60, pos.x)),
        y: Math.max(65, pos.y - 80),
      });

      updateLoupe(pos);
      return;
    }

    // Side dragging (moves both adjacent corners together)
    if (activeSideKey && dragStartSidePosRef.current && dragStartCornersRef.current) {
      const dx = clientX - dragStartSidePosRef.current.clientX;
      const dy = clientY - dragStartSidePosRef.current.clientY;
      const init = dragStartCornersRef.current;
      const maxW = displaySize.width;
      const maxH = displaySize.height;
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

      setCorners(() => {
        if (activeSideKey === 'top') {
          return {
            ...init,
            tl: { ...init.tl, y: clamp(init.tl.y + dy, 0, maxH - 15) },
            tr: { ...init.tr, y: clamp(init.tr.y + dy, 0, maxH - 15) },
          };
        } else if (activeSideKey === 'bottom') {
          return {
            ...init,
            bl: { ...init.bl, y: clamp(init.bl.y + dy, 15, maxH) },
            br: { ...init.br, y: clamp(init.br.y + dy, 15, maxH) },
          };
        } else if (activeSideKey === 'left') {
          return {
            ...init,
            tl: { ...init.tl, x: clamp(init.tl.x + dx, 0, maxW - 15) },
            bl: { ...init.bl, x: clamp(init.bl.x + dx, 0, maxW - 15) },
          };
        } else if (activeSideKey === 'right') {
          return {
            ...init,
            tr: { ...init.tr, x: clamp(init.tr.x + dx, 15, maxW) },
            br: { ...init.br, x: clamp(init.br.x + dx, 15, maxW) },
          };
        }
        return init;
      });
    }
  }, [activeCornerKey, activeSideKey, corners, displaySize, updateLoupe]);

  const handlePointerUp = useCallback(() => {
    if (activeCornerKey) {
      setActiveCornerKey(null);
      setLoupePos(null);
    }
    if (activeSideKey) {
      setActiveSideKey(null);
      dragStartSidePosRef.current = null;
      dragStartCornersRef.current = null;
    }
  }, [activeCornerKey, activeSideKey]);

  useEffect(() => {
    if (activeCornerKey || activeSideKey) {
      window.addEventListener('mousemove', handlePointerMove);
      window.addEventListener('mouseup', handlePointerUp);
      window.addEventListener('touchmove', handlePointerMove, { passive: false });
      window.addEventListener('touchend', handlePointerUp);
    }
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [activeCornerKey, activeSideKey, handlePointerMove, handlePointerUp]);

  // Apply Crop & Perspective Unwarp
  const handleApply = () => {
    if (!imageRef.current || !corners || !scale) return;
    try {
      // Map display corners to natural image coordinates
      const naturalCorners: QuadCorners = {
        tl: { x: corners.tl.x / scale, y: corners.tl.y / scale },
        tr: { x: corners.tr.x / scale, y: corners.tr.y / scale },
        br: { x: corners.br.x / scale, y: corners.br.y / scale },
        bl: { x: corners.bl.x / scale, y: corners.bl.y / scale },
      };

      const unwarped = perspectiveTransform(imageRef.current, naturalCorners);
      onApply(unwarped);
    } catch (err) {
      console.error("Failed to unwarp perspective:", err);
      alert("Gagal melakukan penyesuaian perspektif. Coba sesuaikan posisi 4 sudut kembali.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white rounded-3xl overflow-hidden shadow-2xl border border-slate-800">
      {/* Top action header */}
      <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
          <h2 className="font-bold text-sm tracking-wide">Potong & Perspektif</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-crop-auto"
            onClick={handleAutoDetect}
            disabled={isDetecting}
            className="px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 border border-amber-500/30"
            title="Deteksi tepi dokumen otomatis"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isDetecting ? 'Mendeteksi...' : 'Auto Tepi'}</span>
          </button>

          <button
            id="btn-crop-snap"
            onClick={handleSnapToEdges}
            className="px-3 py-1.5 rounded-full bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 border border-indigo-500/30"
            title="Rapatkan sisi ke kontur kertas terdekat"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Rapatkan</span>
          </button>

          <button
            id="btn-crop-reset"
            onClick={handleResetToMargin}
            className="px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
            title="Reset ke ukuran penuh"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Penuh</span>
          </button>
        </div>
      </div>

      {/* Center Image Container with polygon crop overlay */}
      <div className="relative flex-1 flex items-center justify-center p-3 overflow-hidden select-none bg-slate-950">
        {feedbackMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-indigo-600/95 backdrop-blur-md text-white text-xs font-medium shadow-lg animate-fade-in border border-indigo-400/30 whitespace-nowrap">
            {feedbackMsg}
          </div>
        )}

        <div
          ref={containerRef}
          className="relative inline-block"
          style={{
            width: displaySize.width ? `${displaySize.width}px` : 'auto',
            height: displaySize.height ? `${displaySize.height}px` : 'auto',
          }}
        >
          {/* Base Image */}
          <img
            ref={imageRef}
            src={imageSrc}
            alt="To crop"
            onLoad={handleImageLoad}
            className="block max-h-[58vh] max-w-full object-contain rounded-xl select-none pointer-events-none"
          />

          {/* SVG Overlay for Polygon & Grid */}
          {corners && displaySize.width > 0 && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              viewBox={`0 0 ${displaySize.width} ${displaySize.height}`}
            >
              <defs>
                <mask id="crop-mask">
                  <rect width="100%" height="100%" fill="white" />
                  <polygon
                    points={`${corners.tl.x},${corners.tl.y} ${corners.tr.x},${corners.tr.y} ${corners.br.x},${corners.br.y} ${corners.bl.x},${corners.bl.y}`}
                    fill="black"
                  />
                </mask>
              </defs>

              {/* Dimmed background outside crop area */}
              <rect
                width="100%"
                height="100%"
                fill="rgba(0, 0, 0, 0.68)"
                mask="url(#crop-mask)"
              />

              {/* High-visibility Document Polygon Outline */}
              <polygon
                points={`${corners.tl.x},${corners.tl.y} ${corners.tr.x},${corners.tr.y} ${corners.br.x},${corners.br.y} ${corners.bl.x},${corners.bl.y}`}
                fill="rgba(99, 102, 241, 0.12)"
                stroke="#6366f1"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />

              {/* Perspective guidelines (Rule of thirds inside document) */}
              {[1 / 3, 2 / 3].map((fraction, i) => {
                const topX = corners.tl.x + (corners.tr.x - corners.tl.x) * fraction;
                const topY = corners.tl.y + (corners.tr.y - corners.tl.y) * fraction;
                const botX = corners.bl.x + (corners.br.x - corners.bl.x) * fraction;
                const botY = corners.bl.y + (corners.br.y - corners.bl.y) * fraction;

                const leftX = corners.tl.x + (corners.bl.x - corners.tl.x) * fraction;
                const leftY = corners.tl.y + (corners.bl.y - corners.tl.y) * fraction;
                const rightX = corners.tr.x + (corners.br.x - corners.tr.x) * fraction;
                const rightY = corners.tr.y + (corners.br.y - corners.tr.y) * fraction;

                return (
                  <React.Fragment key={i}>
                    <line
                      x1={topX}
                      y1={topY}
                      x2={botX}
                      y2={botY}
                      stroke="rgba(255, 255, 255, 0.35)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <line
                      x1={leftX}
                      y1={leftY}
                      x2={rightX}
                      y2={rightY}
                      stroke="rgba(255, 255, 255, 0.35)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                  </React.Fragment>
                );
              })}
            </svg>
          )}

          {/* Interactive Side Drag Handles (Move entire side) */}
          {corners && (
            <>
              {/* Top Side Handle */}
              <div
                id="side-handle-top"
                onMouseDown={(e) => handleSidePointerDown('top', e)}
                onTouchStart={(e) => handleSidePointerDown('top', e)}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none group"
                style={{
                  left: `${(corners.tl.x + corners.tr.x) / 2}px`,
                  top: `${(corners.tl.y + corners.tr.y) / 2}px`,
                }}
                title="Geser sisi atas kertas"
              >
                <div className={`px-2.5 py-1 rounded-full border shadow-lg flex items-center gap-1 transition ${
                  activeSideKey === 'top' ? 'bg-amber-500 border-white scale-110' : 'bg-slate-900/90 border-indigo-400/80 group-hover:bg-indigo-600'
                }`}>
                  <MoveVertical className="w-3 h-3 text-white" />
                  <span className="text-[10px] text-white font-medium">Sisi Atas</span>
                </div>
              </div>

              {/* Bottom Side Handle */}
              <div
                id="side-handle-bottom"
                onMouseDown={(e) => handleSidePointerDown('bottom', e)}
                onTouchStart={(e) => handleSidePointerDown('bottom', e)}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none group"
                style={{
                  left: `${(corners.bl.x + corners.br.x) / 2}px`,
                  top: `${(corners.bl.y + corners.br.y) / 2}px`,
                }}
                title="Geser sisi bawah kertas"
              >
                <div className={`px-2.5 py-1 rounded-full border shadow-lg flex items-center gap-1 transition ${
                  activeSideKey === 'bottom' ? 'bg-amber-500 border-white scale-110' : 'bg-slate-900/90 border-indigo-400/80 group-hover:bg-indigo-600'
                }`}>
                  <MoveVertical className="w-3 h-3 text-white" />
                  <span className="text-[10px] text-white font-medium">Sisi Bawah</span>
                </div>
              </div>

              {/* Left Side Handle */}
              <div
                id="side-handle-left"
                onMouseDown={(e) => handleSidePointerDown('left', e)}
                onTouchStart={(e) => handleSidePointerDown('left', e)}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none group"
                style={{
                  left: `${(corners.tl.x + corners.bl.x) / 2}px`,
                  top: `${(corners.tl.y + corners.bl.y) / 2}px`,
                }}
                title="Geser sisi kiri kertas"
              >
                <div className={`px-2 py-1 rounded-full border shadow-lg flex items-center gap-1 transition ${
                  activeSideKey === 'left' ? 'bg-amber-500 border-white scale-110' : 'bg-slate-900/90 border-indigo-400/80 group-hover:bg-indigo-600'
                }`}>
                  <MoveHorizontal className="w-3 h-3 text-white" />
                  <span className="text-[10px] text-white font-medium hidden sm:inline">Kiri</span>
                </div>
              </div>

              {/* Right Side Handle */}
              <div
                id="side-handle-right"
                onMouseDown={(e) => handleSidePointerDown('right', e)}
                onTouchStart={(e) => handleSidePointerDown('right', e)}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none group"
                style={{
                  left: `${(corners.tr.x + corners.br.x) / 2}px`,
                  top: `${(corners.tr.y + corners.br.y) / 2}px`,
                }}
                title="Geser sisi kanan kertas"
              >
                <div className={`px-2 py-1 rounded-full border shadow-lg flex items-center gap-1 transition ${
                  activeSideKey === 'right' ? 'bg-amber-500 border-white scale-110' : 'bg-slate-900/90 border-indigo-400/80 group-hover:bg-indigo-600'
                }`}>
                  <MoveHorizontal className="w-3 h-3 text-white" />
                  <span className="text-[10px] text-white font-medium hidden sm:inline">Kanan</span>
                </div>
              </div>
            </>
          )}

          {/* Interactive Corner Drag Handles (Touch Targets 44px+) */}
          {corners && (
            <>
              {(['tl', 'tr', 'br', 'bl'] as Array<keyof QuadCorners>).map((key) => {
                const pt = corners[key];
                const isActive = activeCornerKey === key;
                return (
                  <div
                    key={key}
                    id={`handle-${key}`}
                    onMouseDown={(e) => handleCornerPointerDown(key, e)}
                    onTouchStart={(e) => handleCornerPointerDown(key, e)}
                    className="absolute z-20 -translate-x-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center cursor-crosshair touch-none group"
                    style={{ left: `${pt.x}px`, top: `${pt.y}px` }}
                  >
                    {/* Visual handle circle with pulse */}
                    <div
                      className={`w-6 h-6 rounded-full border-2 border-white shadow-xl transition-transform ${
                        isActive ? 'scale-125 bg-amber-500 shadow-amber-500/50 ring-4 ring-amber-400/40' : 'bg-indigo-600 group-hover:scale-110'
                      } flex items-center justify-center`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Magnifier Loupe floating element */}
          {loupePos && (
            <div
              className="absolute z-30 pointer-events-none -translate-x-1/2 -translate-y-1/2 drop-shadow-2xl animate-scale-up"
              style={{ left: `${loupePos.x}px`, top: `${loupePos.y}px` }}
            >
              <canvas
                ref={loupeCanvasRef}
                className="w-28 h-28 rounded-full border-2 border-white shadow-2xl bg-black"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom control bar */}
      <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-4 z-10">
        <button
          id="btn-crop-cancel"
          onClick={onCancel}
          className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm flex items-center justify-center gap-2 transition active:scale-95"
        >
          <X className="w-4 h-4" />
          <span>Batal</span>
        </button>

        <button
          id="btn-crop-apply"
          onClick={handleApply}
          className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition active:scale-95"
        >
          <Check className="w-4 h-4" />
          <span>Terapkan</span>
        </button>
      </div>
    </div>
  );
};
