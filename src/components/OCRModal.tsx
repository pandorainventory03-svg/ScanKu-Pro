import React, { useState } from 'react';
import { Copy, Check, Download, X, Sparkles, FileText, RefreshCw } from 'lucide-react';

interface OCRModalProps {
  isOpen: boolean;
  isLoading: boolean;
  loadingStatus: string;
  loadingProgress: number;
  initialText: string;
  onClose: () => void;
  onRetry: () => void;
}

export const OCRModal: React.FC<OCRModalProps> = ({
  isOpen,
  isLoading,
  loadingStatus,
  loadingProgress,
  initialText,
  onClose,
  onRetry,
}) => {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    setText(initialText);
  }, [initialText]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Gagal menyalin teks ke papan klip.");
    }
  };

  const handleDownloadTxt = () => {
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ScanKu_OCR_${Date.now()}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Hasil Ketik Ulang Dokumen (OCR)</h3>
              <p className="text-[11px] text-slate-500">Mendeteksi teks bahasa Indonesia & Inggris</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto flex flex-col">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4 text-indigo-600 animate-pulse">
                <RefreshCw className="w-7 h-7 animate-spin" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-1">{loadingStatus || 'Sedang memproses OCR...'}</h4>
              <p className="text-xs text-slate-500 max-w-xs mb-4">
                Sistem sedang mengenali karakter dan tata letak paragraf dokumen.
              </p>
              {loadingProgress > 0 && (
                <div className="w-48 bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="bg-indigo-600 h-full transition-all duration-200"
                    style={{ width: `${loadingProgress}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium">Teks Hasil Pindai (Dapat Diedit):</span>
                <span>{text.length} karakter</span>
              </div>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tidak ada teks yang terdeteksi pada dokumen."
                className="w-full flex-1 min-h-[220px] p-3.5 rounded-2xl border border-slate-200 bg-slate-50/50 text-slate-800 text-xs font-mono leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {!isLoading && (
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2.5">
            <button
              onClick={onRetry}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 transition flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Scan Ulang</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={!text}
                className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-semibold shadow-2xs hover:bg-slate-50 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Tersalin!' : 'Salin Teks'}</span>
              </button>

              <button
                onClick={handleDownloadTxt}
                disabled={!text}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh .txt</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
