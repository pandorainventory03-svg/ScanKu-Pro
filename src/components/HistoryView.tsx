import React from 'react';
import { Trash2, Download, Eye, FileText, Calendar, Inbox, Image as ImageIcon } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { ScanHistoryItem } from '../types';

interface HistoryViewProps {
  items: ScanHistoryItem[];
  onOpenItem: (item: ScanHistoryItem) => void;
  onDeleteItem: (id: number) => void;
  onClearAll: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  items,
  onOpenItem,
  onDeleteItem,
  onClearAll,
}) => {
  const downloadPNG = (item: ScanHistoryItem) => {
    const link = document.createElement('a');
    link.download = `ScanKu_${item.title.replace(/\s+/g, '_')}_${Date.now()}.png`;
    link.href = item.scanned;
    link.click();
  };

  const downloadPDF = (item: ScanHistoryItem) => {
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = 210;
      const pageH = 297;
      const margin = 10;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;

      const img = new Image();
      img.onload = () => {
        const cw = img.width;
        const ch = img.height;
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

        doc.addImage(item.scanned, 'PNG', x, y, finalW, finalH);

        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.setFont('helvetica', 'italic');
        doc.text(
          `ScanKu Pro • ${new Date(item.timestamp).toLocaleDateString('id-ID')}`,
          pageW - margin,
          pageH - 6,
          { align: 'right' }
        );

        doc.save(`ScanKu_${item.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
      };
      img.src = item.scanned;
    } catch (err: any) {
      alert('Gagal membuat PDF: ' + err.message);
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'color': return 'Magic Color';
      case 'bw': return 'Hitam-Putih';
      case 'grayscale': return 'Grayscale';
      default: return 'Asli';
    }
  };

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <h2 className="font-bold text-base text-slate-800 tracking-tight">Riwayat Dokumen</h2>
          <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-100">
            {items.length}
          </span>
        </div>

        {items.length > 0 && (
          <button
            id="btn-clear-history-all"
            onClick={onClearAll}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Hapus Semua</span>
          </button>
        )}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="py-16 px-4 text-center flex flex-col items-center justify-center text-slate-400">
          <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
            <Inbox className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h3 className="font-bold text-slate-700 text-sm mb-1">Belum ada riwayat dokumen</h3>
          <p className="text-xs text-slate-500 max-w-xs">
            Scan dokumen dari kamera atau unggah foto, lalu simpan untuk melihatnya kembali di sini.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const dateObj = new Date(item.timestamp);
            const dateFormatted = dateObj.toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            const timeFormatted = dateObj.toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={item.id}
                className="group bg-white rounded-2xl p-3 border border-slate-200/80 shadow-xs hover:shadow-md hover:border-slate-300 transition-all flex items-center gap-3.5"
              >
                {/* Thumbnail */}
                <div
                  onClick={() => onOpenItem(item)}
                  className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0 cursor-pointer"
                >
                  <img
                    src={item.scanned}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-xs text-[9px] text-white font-medium text-center py-0.5 uppercase tracking-wider">
                    {item.mode}
                  </div>
                </div>

                {/* Metadata */}
                <div className="flex-1 min-w-0">
                  <h4
                    onClick={() => onOpenItem(item)}
                    className="font-bold text-sm text-slate-800 truncate cursor-pointer hover:text-indigo-600 transition"
                  >
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {dateFormatted} • {timeFormatted}
                    </span>
                  </div>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                    {getModeLabel(item.mode)}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onOpenItem(item)}
                    className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 flex items-center justify-center transition"
                    title="Buka Dokumen"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => downloadPNG(item)}
                    className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 flex items-center justify-center transition"
                    title="Unduh PNG"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => downloadPDF(item)}
                    className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 flex items-center justify-center transition"
                    title="Unduh PDF"
                  >
                    <FileText className="w-4 h-4" />
                  </button>

                  {item.id && (
                    <button
                      onClick={() => onDeleteItem(item.id!)}
                      className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition"
                      title="Hapus"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
