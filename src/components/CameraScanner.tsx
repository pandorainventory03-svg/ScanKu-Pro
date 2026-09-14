import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, Zap, ZapOff, CheckCircle2, ScanLine, X, Sparkles } from 'lucide-react';
import { Point, QuadCorners, DetectionResult } from '../types';
import { detectDocumentCorners, CornerSmoother, calculateQuadArea, orderCorners } from '../utils/documentDetector';

interface CameraScannerProps {
  onCapture: (imageDataUrl: string, detectedCorners?: QuadCorners) => void;
  onClose: () => void;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [autoSnap, setAutoSnap] = useState(false);
  const [detectionState, setDetectionState] = useState<{
    detected: boolean;
    confidence: number;
    stabilityProgress: number; // 0 to 100 for auto-snap
  }>({
    detected: false,
    confidence: 0,
    stabilityProgress: 0
  });

  const [cameraError, setCameraError] = useState<string | null>(null);

  // References for live tracking loop
  const smootherRef = useRef<CornerSmoother>(new CornerSmoother(0.4));
  const latestNativeCornersRef = useRef<QuadCorners | null>(null);
  const latestScreenCornersRef = useRef<QuadCorners | null>(null);
  const isDocumentStableRef = useRef<{ count: number; lastArea: number }>({ count: 0, lastArea: 0 });
  const animFrameIdRef = useRef<number | null>(null);
  const frameCounterRef = useRef<number>(0);
  const autoSnappedRef = useRef<boolean>(false);

  // Start / restart camera
  const initCamera = useCallback(async (mode: 'environment' | 'user') => {
    setCameraError(null);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
        },
        audio: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play();
      }

      // Check torch capability
      const videoTrack = newStream.getVideoTracks()[0];
      const capabilities: any = videoTrack?.getCapabilities ? videoTrack.getCapabilities() : {};
      setHasTorch(Boolean(capabilities?.torch));
    } catch (err: any) {
      console.warn("Camera init error with ideal resolution, fallback to basic constraints:", err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode },
          audio: false,
        });
        setStream(fallbackStream);
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play();
        }
      } catch (fallbackErr: any) {
        console.error("Camera access failed:", fallbackErr);
        setCameraError(
          fallbackErr.name === 'NotAllowedError'
            ? 'Izin akses kamera ditolak. Silakan izinkan akses kamera pada peramban Anda.'
            : 'Tidak dapat membuka kamera. Pastikan kamera tidak sedang digunakan oleh aplikasi lain.'
        );
      }
    }
  }, [stream]);

  useEffect(() => {
    initCamera(facingMode);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode]);

  // Toggle Torch
  const toggleTorch = async () => {
    if (!stream || !hasTorch) return;
    const track = stream.getVideoTracks()[0];
    try {
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }]
      });
      setTorchOn(nextState);
    } catch (e) {
      console.error("Torch error:", e);
    }
  };

  // Switch Camera (front/back)
  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Capture current frame
  const captureFrame = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, vw, vh);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    // Pass native coordinates directly, matching the captured photo resolution
    const nativeCorners = latestNativeCornersRef.current;
    onCapture(dataUrl, nativeCorners ? { ...nativeCorners } : undefined);
  }, [onCapture]);

  // Live Auto-Tracking Animation Loop
  useEffect(() => {
    let active = true;

    const trackingLoop = () => {
      if (!active) return;

      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;

      if (video && overlay && video.readyState >= 2 && video.videoWidth > 0) {
        // Match overlay canvas size to display size
        const rect = video.getBoundingClientRect();
        if (overlay.width !== Math.round(rect.width) || overlay.height !== Math.round(rect.height)) {
          overlay.width = Math.round(rect.width);
          overlay.height = Math.round(rect.height);
        }

        const W = overlay.width;
        const H = overlay.height;
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const ctx = overlay.getContext('2d');

        if (ctx && W > 0 && H > 0 && vw > 0 && vh > 0) {
          ctx.clearRect(0, 0, W, H);

          frameCounterRef.current++;
          // Detect in native resolution every 3 frames for precision and high FPS
          let detResult: DetectionResult | null = null;
          if (frameCounterRef.current % 3 === 0) {
            detResult = detectDocumentCorners(video, vw, vh);
          }

          if (detResult && detResult.isDocumentDetected) {
            const smoothed = smootherRef.current.update(detResult.corners, true);
            latestNativeCornersRef.current = smoothed;

            // Project native corners to screen viewport coordinates
            const scale = Math.min(W / vw, H / vh);
            const renderW = Math.round(vw * scale);
            const renderH = Math.round(vh * scale);
            const offsetX = Math.round((W - renderW) / 2);
            const offsetY = Math.round((H - renderH) / 2);

            const toScreen = (pt: Point) => ({
              x: offsetX + pt.x * scale,
              y: offsetY + pt.y * scale,
            });

            latestScreenCornersRef.current = {
              tl: toScreen(smoothed.tl),
              tr: toScreen(smoothed.tr),
              br: toScreen(smoothed.br),
              bl: toScreen(smoothed.bl),
            };

            // Check stability for auto-snap
            const area = calculateQuadArea(smoothed);
            const areaDiff = Math.abs(area - isDocumentStableRef.current.lastArea) / (area || 1);
            isDocumentStableRef.current.lastArea = area;

            if (areaDiff < 0.04 && detResult.confidence >= 65) {
              isDocumentStableRef.current.count = Math.min(30, isDocumentStableRef.current.count + 1);
            } else {
              isDocumentStableRef.current.count = Math.max(0, isDocumentStableRef.current.count - 2);
            }

            const progress = Math.min(100, Math.round((isDocumentStableRef.current.count / 22) * 100));
            setDetectionState({
              detected: true,
              confidence: detResult.confidence,
              stabilityProgress: progress
            });

            // Trigger auto-snap if stable
            if (autoSnap && progress >= 100 && !autoSnappedRef.current) {
              autoSnappedRef.current = true;
              captureFrame();
              return;
            }
          } else if (frameCounterRef.current % 3 === 0) {
            isDocumentStableRef.current.count = Math.max(0, isDocumentStableRef.current.count - 3);
            setDetectionState((prev) => ({
              ...prev,
              detected: false,
              stabilityProgress: 0
            }));
          }

          // Render Tracking HUD
          if (latestScreenCornersRef.current && detectionState.detected) {
            const { tl, tr, br, bl } = latestScreenCornersRef.current;

            // 1. Semi-transparent document fill
            ctx.beginPath();
            ctx.moveTo(tl.x, tl.y);
            ctx.lineTo(tr.x, tr.y);
            ctx.lineTo(br.x, br.y);
            ctx.lineTo(bl.x, bl.y);
            ctx.closePath();

            const isHighConfidence = detectionState.confidence >= 70;
            ctx.fillStyle = isHighConfidence ? 'rgba(16, 185, 129, 0.22)' : 'rgba(59, 130, 246, 0.18)';
            ctx.fill();

            // 2. Glowing animated boundary lines
            ctx.strokeStyle = isHighConfidence ? '#10b981' : '#3b82f6';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([]);
            ctx.stroke();

            // 3. Document Corner Brackets
            const pts = [tl, tr, br, bl];
            pts.forEach((pt) => {
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
              ctx.fillStyle = isHighConfidence ? '#10b981' : '#3b82f6';
              ctx.fill();

              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2;
              ctx.stroke();
            });
          } else {
            // Document Guide Rectangle (When searching)
            const margin = Math.min(W, H) * 0.1;
            const gw = W - 2 * margin;
            const gh = H - 2 * margin;
            const cornerSize = 28;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;

            // Top-left
            ctx.beginPath();
            ctx.moveTo(margin, margin + cornerSize);
            ctx.lineTo(margin, margin);
            ctx.lineTo(margin + cornerSize, margin);
            ctx.stroke();

            // Top-right
            ctx.beginPath();
            ctx.moveTo(margin + gw - cornerSize, margin);
            ctx.lineTo(margin + gw, margin);
            ctx.lineTo(margin + gw, margin + cornerSize);
            ctx.stroke();

            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(margin + gw, margin + gh - cornerSize);
            ctx.lineTo(margin + gw, margin + gh);
            ctx.lineTo(margin + gw - cornerSize, margin + gh);
            ctx.stroke();

            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(margin + cornerSize, margin + gh);
            ctx.lineTo(margin, margin + gh);
            ctx.lineTo(margin, margin + gh - cornerSize);
            ctx.stroke();
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(trackingLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(trackingLoop);

    return () => {
      active = false;
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [autoSnap, captureFrame, detectionState.detected, detectionState.confidence]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-between select-none overflow-hidden">
      {/* Top Header Bar */}
      <div className="w-full max-w-lg px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent z-10">
        <button
          id="btn-close-cam"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white active:scale-95 transition"
          aria-label="Tutup kamera"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Live Tracking Status Badge */}
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 text-xs font-semibold">
          {detectionState.detected ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Dokumen Terdeteksi ({detectionState.confidence}%)
              </span>
            </>
          ) : (
            <>
              <ScanLine className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="text-slate-300">Arahkan ke dokumen...</span>
            </>
          )}
        </div>

        {/* Action Controls (Torch & Auto-Snap) */}
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              id="btn-toggle-torch"
              onClick={toggleTorch}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 ${
                torchOn ? 'bg-amber-400 text-black' : 'bg-white/20 backdrop-blur-md text-white'
              }`}
              title="Lampu Kilat"
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          <button
            id="btn-toggle-autosnap"
            onClick={() => setAutoSnap((prev) => !prev)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition ${
              autoSnap ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-white/20 text-slate-300 backdrop-blur-md'
            }`}
            title="Auto Capture saat dokumen stabil"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto</span>
          </button>
        </div>
      </div>

      {/* Main Video Viewport with Live Tracking Overlay */}
      <div className="relative flex-1 w-full max-w-lg flex items-center justify-center overflow-hidden">
        {cameraError ? (
          <div className="p-6 text-center text-white max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <Camera className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-lg mb-2">Kendala Kamera</h3>
            <p className="text-sm text-slate-300 mb-6">{cameraError}</p>
            <button
              onClick={() => initCamera(facingMode)}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-lg active:scale-95"
            >
              Coba Lagi
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              autoPlay
              muted
              className="w-full h-full object-contain"
            />
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </>
        )}
      </div>

      {/* Bottom Control Shutter Bar */}
      <div className="w-full max-w-lg px-8 py-6 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-around z-10">
        <button
          id="btn-flip-cam"
          onClick={flipCamera}
          className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white active:scale-95 transition"
          title="Putar Kamera"
        >
          <RefreshCw className="w-5 h-5" />
        </button>

        {/* Shutter Capture Button with circular progress ring for Auto-Snap */}
        <div className="relative flex items-center justify-center">
          {autoSnap && detectionState.stabilityProgress > 0 && (
            <svg className="absolute w-22 h-22 -rotate-90 pointer-events-none">
              <circle
                cx="44"
                cy="44"
                r="40"
                className="text-white/20"
                strokeWidth="4"
                stroke="currentColor"
                fill="transparent"
              />
              <circle
                cx="44"
                cy="44"
                r="40"
                className="text-emerald-400 transition-all duration-150"
                strokeWidth="4"
                strokeDasharray={251.2}
                strokeDashoffset={251.2 - (251.2 * detectionState.stabilityProgress) / 100}
                strokeLinecap="round"
                stroke="currentColor"
                fill="transparent"
              />
            </svg>
          )}

          <button
            id="btn-shutter-capture"
            onClick={captureFrame}
            className="w-18 h-18 rounded-full bg-white p-1.5 shadow-2xl active:scale-90 transition transform"
            aria-label="Ambil Foto Dokumen"
          >
            <div className="w-full h-full rounded-full border-2 border-slate-900 bg-white flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-indigo-900" />
            </div>
          </button>
        </div>

        {/* Placeholder spacer for visual symmetry */}
        <div className="w-12 h-12" />
      </div>
    </div>
  );
};
