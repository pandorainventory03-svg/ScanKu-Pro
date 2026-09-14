import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Upload,
  FileText,
  Image as ImageIcon,
  History as HistoryIcon,
  Home,
  Sparkles,
  Crop,
  RotateCcw,
  Save,
  Check,
  AlertCircle,
  Eye,
  Layers,
  Palette,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { QuadCorners, ScanFilterMode, ScanHistoryItem } from './types';
import { detectDocumentCorners, snapCornersToEdges } from './utils/documentDetector';
import { perspectiveTransform } from './utils/perspectiveTransform';
import { enhanceDocumentImage } from './utils/imageEnhancement';
import { saveScanItem, getScanItems, deleteScanItem, clearAllScanItems } from './utils/indexedDb';
import { performOCR } from './utils/ocrService';
import { CameraScanner } from './components/CameraScanner';
import { CropEditor } from './components/CropEditor';
import { HistoryView } from './components/HistoryView';
import { OCRModal } from './components/OCRModal';

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'home' | 'scan' | 'history'>('home');

  // Document states
  const [originalImageSrc, setOriginalImageSrc] = useState<string | null>(null);
  const [unwarpedCanvas, setUnwarpedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [enhancedDataUrl, setEnhancedDataUrl] = useState<string | null>(null);
  const [currentFilter, setCurrentFilter] = useState<ScanFilterMode>('color');
  const [detectedCorners, setDetectedCorners] = useState<QuadCorners | null>(null);

  // Flow states
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // History state
  const [historyItems, setHistoryItems] = useState<ScanHistoryItem[]>([]);
  const [isSavedInHistory, setIsSavedInHistory] = useState<boolean>(false);

  // OCR state
  const [isOCRModalOpen, setIsOCRModalOpen] = useState<boolean>(false);
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [ocrResultText, setOcrResultText] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Show toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Load History from IndexedDB
  const refreshHistory = async () => {
    try {
      const items = await getScanItems();
      setHistoryItems(items);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  // Process and apply enhancement filter whenever unwarped canvas or filter changes
  useEffect(() => {
    if (!unwarpedCanvas) return;

    setIsProcessing(true);
    // Use requestAnimationFrame so UI renders spinner smoothly
    requestAnimationFrame(() => {
      try {
        const enhanced = enhanceDocumentImage(unwarpedCanvas, currentFilter);
        setEnhancedDataUrl(enhanced.toDataURL('image/png'));
      } catch (err) {
        console.error("Filter error:", err);
      } finally {
        setIsProcessing(false);
      }
    });
  }, [unwarpedCanvas, currentFilter]);

  // Load new image (from file upload or camera capture)
  const handleLoadImage = (dataUrl: string, predetectedCorners?: QuadCorners) => {
    setOriginalImageSrc(dataUrl);
    setIsSavedInHistory(false);

    // Create an image element to detect corners and auto unwarp
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;

      let corners = predetectedCorners;
      if (!corners) {
        // Run smart edge detection on the image
        const det = detectDocumentCorners(img, nw, nh);
        corners = det.corners;
      } else {
        // Refine corners against high-resolution photo contours
        corners = snapCornersToEdges(img, corners, nw, nh);
      }

      setDetectedCorners(corners);

      try {
        // Auto-unwarp using detected document quadrilateral
        const unwarped = perspectiveTransform(img, corners);
        setUnwarpedCanvas(unwarped);
        showToast("✨ Dokumen otomatis dilacak & diratakan");
      } catch (e) {
        console.error("Auto unwarp fallback:", e);
        // Fallback: draw directly without transform
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = nw;
        fallbackCanvas.height = nh;
        const ctx = fallbackCanvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        setUnwarpedCanvas(fallbackCanvas);
      }

      setActiveTab('home');
    };
    img.src = dataUrl;
  };

  // File Upload Handler
  const handleFileUpload = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Format berkas tidak didukung. Silakan unggah gambar.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        handleLoadImage(e.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Drag & Drop
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => {
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Download PNG
  const handleDownloadPNG = () => {
    if (!enhancedDataUrl) return;
    const link = document.createElement('a');
    link.download = `ScanKu_${Date.now()}.png`;
    link.href = enhancedDataUrl;
    link.click();
    showToast("Berkas PNG berhasil diunduh");
  };

  // Download PDF
  const handleDownloadPDF = () => {
    if (!enhancedDataUrl || !unwarpedCanvas) return;
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = 210;
      const pageH = 297;
      const margin = 10;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;

      const cw = unwarpedCanvas.width;
      const ch = unwarpedCanvas.height;
      let finalW: number, finalH: number;

      if (cw / ch > maxW / maxH) {
        finalW = maxW;
        finalH = (maxW * ch) / cw;
      } else {
        finalH = maxH;
        finalW = (maxH * cw) / ch;
      }

      const x = (pageW - finalW) / 2;
      const y = (pageH - finalH) / 2;

      doc.addImage(enhancedDataUrl, 'PNG', x, y, finalW, finalH);

      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.setFont('helvetica', 'italic');
      doc.text(
        `ScanKu Pro • ${new Date().toLocaleDateString('id-ID')}`,
        pageW - margin,
        pageH - 6,
        { align: 'right' }
      );

      doc.save(`ScanKu_Dokumen_${Date.now()}.pdf`);
      showToast("Berkas PDF siap dicetak berhasil diunduh");
    } catch (err: any) {
      alert("Gagal mengunduh PDF: " + err.message);
    }
  };

  // Save to IndexedDB History
  const handleSaveToHistory = async () => {
    if (!originalImageSrc || !enhancedDataUrl) return;
    try {
      await saveScanItem({
        title: `Dokumen ${new Date().toLocaleDateString('id-ID')}`,
        original: originalImageSrc,
        scanned: enhancedDataUrl,
        mode: currentFilter,
        timestamp: new Date().toISOString(),
      });
      setIsSavedInHistory(true);
      await refreshHistory();
      showToast("✅ Berhasil disimpan ke Riwayat!");
    } catch (e: any) {
      alert("Gagal menyimpan ke riwayat: " + e.message);
    }
  };

  // Start OCR
  const handleStartOCR = async () => {
    if (!enhancedDataUrl) return;
    setIsOCRModalOpen(true);
    setOcrLoading(true);
    setOcrProgress(0);
    setOcrStatus('Memulai mesin OCR...');

    try {
      const res = await performOCR(enhancedDataUrl, (status, progress) => {
        setOcrStatus(status);
        setOcrProgress(progress);
      });
      setOcrResultText(res.text || 'Tidak ada teks yang terdeteksi.');
    } catch (err: any) {
      console.error("OCR error:", err);
      setOcrResultText(`Gagal mengenali teks: ${err.message || 'Periksa koneksi internet.'}`);
    } finally {
      setOcrLoading(false);
    }
  };

  // Open item from history
  const handleOpenFromHistory = (item: ScanHistoryItem) => {
    handleLoadImage(item.original);
    setCurrentFilter(item.mode);
    setIsSavedInHistory(true);
  };

  // Delete item from history
  const handleDeleteFromHistory = async (id: number) => {
    if (confirm("Hapus dokumen ini dari riwayat?")) {
      await deleteScanItem(id);
      await refreshHistory();
      showToast("Dokumen dihapus dari riwayat");
    }
  };

  // Clear all history
  const handleClearAllHistory = async () => {
    if (confirm("Hapus semua riwayat scan dokumen?")) {
      await clearAllScanItems();
      await refreshHistory();
      showToast("Semua riwayat dibersihkan");
    }
  };

  // Reset current document
  const handleResetDocument = () => {
    setOriginalImageSrc(null);
    setUnwarpedCanvas(null);
    setEnhancedDataUrl(null);
    setDetectedCorners(null);
    setIsCropping(false);
    setIsSavedInHistory(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex justify-center items-center sm:py-6 selection:bg-indigo-500 selection:text-white font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white px-4 py-2.5 rounded-full shadow-2xl border border-indigo-500/30 text-xs font-semibold flex items-center gap-2 backdrop-blur-md animate-fade-in whitespace-nowrap">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Application Container Mobile Shell */}
      <div className="w-full max-w-[480px] h-screen sm:h-[860px] bg-slate-50 sm:rounded-[36px] shadow-2xl flex flex-col overflow-hidden relative border border-slate-200/60">
        {/* Top Header */}
        <header className="px-5 py-3.5 bg-white border-b border-slate-200/70 flex items-center justify-between flex-shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-800 to-blue-900 flex items-center justify-center text-white shadow-md shadow-indigo-700/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-extrabold text-base text-slate-900 tracking-tight leading-none">
                  ScanKu <span className="text-indigo-600 font-black">Pro</span>
                </h1>
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[9px] font-bold border border-indigo-100">
                  AI Track
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">Pemindai Dokumen & Auto-Tracking Cerdas</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              Auto-Track
            </span>
          </div>
        </header>

        {/* Main Body Content Scrollable Area */}
        <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-100/60">
          {/* TAB 1: BERANDA / HOME */}
          {activeTab === 'home' && (
            <>
              {/* If no image loaded yet: Upload Zone + Camera Launcher */}
              {!originalImageSrc ? (
                <div className="flex-1 flex flex-col gap-4 justify-center py-4">
                  {/* Camera Launcher Hero Button */}
                  <button
                    id="btn-launch-camera"
                    onClick={() => setActiveTab('scan')}
                    className="w-full bg-gradient-to-r from-indigo-700 via-indigo-600 to-blue-700 hover:from-indigo-600 hover:to-blue-600 text-white p-5 rounded-3xl shadow-xl shadow-indigo-700/25 flex items-center justify-between transition-all active:scale-[0.98] group border border-indigo-500/20"
                  >
                    <div className="flex items-center gap-4 text-left">
                      <div className="w-13 h-13 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                        <Camera className="w-7 h-7" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 font-bold text-base leading-tight">
                          <span>Scan Kamera Langsung</span>
                          <Sparkles className="w-4 h-4 text-amber-300" />
                        </div>
                        <p className="text-xs text-indigo-100/80 mt-1">
                          Auto-tracking real-time mendeteksi 4 sudut kertas
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-indigo-200 group-hover:translate-x-1 transition-transform" />
                  </button>

                  {/* Drag & Drop File Upload Area */}
                  <div
                    id="upload-dropzone"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-3xl p-7 text-center cursor-pointer transition-all bg-white flex flex-col items-center justify-center gap-2 shadow-xs ${
                      isDragOver
                        ? 'border-indigo-600 bg-indigo-50/50 scale-[1.01]'
                        : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                        e.target.value = '';
                      }}
                    />

                    <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-1">
                      <Upload className="w-7 h-7 stroke-[1.8]" />
                    </div>

                    <h3 className="font-bold text-sm text-slate-800">
                      Pilih atau Seret Foto Dokumen
                    </h3>
                    <p className="text-xs text-slate-500 max-w-xs">
                      Otomatis meluruskan perspektif dan menghilangkan bayangan gelap
                    </p>
                    <span className="text-[10px] font-semibold text-slate-400 mt-2 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">
                      JPG, PNG, WEBP, BMP (Maks. 15 MB)
                    </span>
                  </div>

                  {/* Feature Highlights Pill */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-center justify-around text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <span className="text-[11px] font-bold text-slate-700">Auto-Tracking</span>
                      <span className="text-[9px] text-slate-400">Deteksi Sudut Otomatis</span>
                    </div>

                    <div className="w-px h-8 bg-slate-200" />

                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <span className="text-[11px] font-bold text-slate-700">Magic Color</span>
                      <span className="text-[9px] text-slate-400">Pembersih Bayangan</span>
                    </div>

                    <div className="w-px h-8 bg-slate-200" />

                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
                        <FileText className="w-4 h-4" />
                      </div>
                      <span className="text-[11px] font-bold text-slate-700">OCR & PDF</span>
                      <span className="text-[9px] text-slate-400">Ekspor Siap Cetak</span>
                    </div>
                  </div>
                </div>
              ) : isCropping ? (
                /* Interactive 4-Corner Crop & Perspective Editor */
                <CropEditor
                  imageSrc={originalImageSrc}
                  initialCorners={detectedCorners || undefined}
                  onApply={(newUnwarped) => {
                    setUnwarpedCanvas(newUnwarped);
                    setIsCropping(false);
                    showToast("Perspektif dokumen berhasil disesuaikan");
                  }}
                  onCancel={() => setIsCropping(false)}
                />
              ) : (
                /* Document Preview & Tools */
                <div className="flex flex-col gap-4 animate-fade-in">
                  {/* Preview Canvas Card */}
                  <div className="bg-white rounded-3xl p-3 border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="relative rounded-2xl overflow-hidden bg-slate-900/5 min-h-[220px] max-h-[340px] flex items-center justify-center">
                      {isProcessing && (
                        <div className="absolute inset-0 bg-white/75 backdrop-blur-xs flex flex-col items-center justify-center z-20">
                          <div className="w-9 h-9 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-2" />
                          <span className="text-xs font-semibold text-slate-700">Memproses Filter...</span>
                        </div>
                      )}

                      {enhancedDataUrl ? (
                        <img
                          src={enhancedDataUrl}
                          alt="Scanned result"
                          className="max-h-[340px] w-auto max-w-full object-contain rounded-xl shadow-xs"
                        />
                      ) : (
                        <div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                      )}
                    </div>

                    {/* Quick overlay buttons */}
                    <div className="flex items-center justify-between mt-3 px-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>Dokumen Terpindai</span>
                      </div>

                      <button
                        id="btn-edit-crop"
                        onClick={() => setIsCropping(true)}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full transition flex items-center gap-1.5 active:scale-95 border border-indigo-200/60"
                      >
                        <Crop className="w-3.5 h-3.5" />
                        <span>Atur Sudut & Potong</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter Mode Selector Pills */}
                  <div className="bg-white rounded-2xl p-2.5 border border-slate-200/80 shadow-xs">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5 text-indigo-600" /> Mode Warna:
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: 'color', label: 'Magic Color', icon: Sparkles },
                        { id: 'bw', label: 'Hitam-Putih', icon: Layers },
                        { id: 'grayscale', label: 'Grayscale', icon: Eye },
                        { id: 'original', label: 'Asli', icon: ImageIcon },
                      ].map((m) => {
                        const Icon = m.icon;
                        const isSelected = currentFilter === m.id;
                        return (
                          <button
                            key={m.id}
                            id={`filter-btn-${m.id}`}
                            onClick={() => setCurrentFilter(m.id as ScanFilterMode)}
                            className={`py-2 px-1.5 rounded-xl text-center text-xs font-bold transition flex flex-col items-center gap-1 active:scale-95 ${
                              isSelected
                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Icon className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-slate-500'}`} />
                            <span className="text-[10px] leading-tight">{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Document Actions Bar */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      id="btn-download-pdf"
                      onClick={handleDownloadPDF}
                      className="py-3 px-4 rounded-2xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-700/20 transition active:scale-95"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Unduh PDF (A4)</span>
                    </button>

                    <button
                      id="btn-download-png"
                      onClick={handleDownloadPNG}
                      className="py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition active:scale-95"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>Unduh PNG</span>
                    </button>
                  </div>

                  {/* AI Ketik Ulang (OCR) & Save Buttons */}
                  <div className="flex flex-col gap-2">
                    <button
                      id="btn-ocr-extract"
                      onClick={handleStartOCR}
                      className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-pink-600/20 transition active:scale-95"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Ketik Ulang Teks (OCR)</span>
                    </button>

                    <div className="flex gap-2">
                      <button
                        id="btn-save-to-history"
                        onClick={handleSaveToHistory}
                        disabled={isSavedInHistory}
                        className={`flex-1 py-2.5 px-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 ${
                          isSavedInHistory
                            ? 'bg-slate-200 text-slate-500 cursor-default'
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/70'
                        }`}
                      >
                        {isSavedInHistory ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-600" />
                            <span>Tersimpan di Riwayat</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            <span>Simpan ke Riwayat</span>
                          </>
                        )}
                      </button>

                      <button
                        id="btn-reset-document"
                        onClick={handleResetDocument}
                        className="py-2.5 px-4 rounded-2xl bg-slate-200/80 hover:bg-slate-300 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Dokumen Baru</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: SCAN KAMERA */}
          {activeTab === 'scan' && (
            <CameraScanner
              onCapture={(dataUrl, corners) => {
                handleLoadImage(dataUrl, corners);
              }}
              onClose={() => setActiveTab('home')}
            />
          )}

          {/* TAB 3: RIWAYAT */}
          {activeTab === 'history' && (
            <HistoryView
              items={historyItems}
              onOpenItem={(item) => {
                handleOpenFromHistory(item);
                setActiveTab('home');
              }}
              onDeleteItem={handleDeleteFromHistory}
              onClearAll={handleClearAllHistory}
            />
          )}
        </main>

        {/* Bottom Navigation Bar */}
        {activeTab !== 'scan' && (
          <nav className="px-6 py-2.5 bg-white border-t border-slate-200/70 flex items-center justify-around flex-shrink-0 z-10">
            <button
              id="nav-tab-home"
              onClick={() => setActiveTab('home')}
              className={`flex flex-col items-center gap-1 text-xs font-semibold py-1 px-4 rounded-2xl transition ${
                activeTab === 'home' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Home className={`w-5 h-5 ${activeTab === 'home' ? 'stroke-[2.5]' : ''}`} />
              <span className="text-[11px]">Beranda</span>
            </button>

            <button
              id="nav-tab-scan"
              onClick={() => setActiveTab('scan')}
              className="relative -top-3 flex flex-col items-center"
            >
              <div className="w-13 h-13 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 active:scale-90 transition transform">
                <Camera className="w-6 h-6 stroke-[2.2]" />
              </div>
              <span className="text-[10px] font-bold text-indigo-700 mt-0.5">Scan Kamera</span>
            </button>

            <button
              id="nav-tab-history"
              onClick={() => setActiveTab('history')}
              className={`flex flex-col items-center gap-1 text-xs font-semibold py-1 px-4 rounded-2xl transition relative ${
                activeTab === 'history' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <HistoryIcon className={`w-5 h-5 ${activeTab === 'history' ? 'stroke-[2.5]' : ''}`} />
              <span className="text-[11px]">Riwayat</span>
              {historyItems.length > 0 && (
                <span className="absolute top-0.5 right-3 w-2 h-2 rounded-full bg-indigo-600" />
              )}
            </button>
          </nav>
        )}

        {/* OCR Result & Editing Modal */}
        <OCRModal
          isOpen={isOCRModalOpen}
          isLoading={ocrLoading}
          loadingStatus={ocrStatus}
          loadingProgress={ocrProgress}
          initialText={ocrResultText}
          onClose={() => setIsOCRModalOpen(false)}
          onRetry={handleStartOCR}
        />
      </div>
    </div>
  );
}
