export interface OCRProgressCallback {
  (status: string, progress: number): void;
}

declare global {
  interface Window {
    Tesseract?: any;
  }
}

let tesseractLoadingPromise: Promise<any> | null = null;

export function loadTesseract(): Promise<any> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadingPromise) return tesseractLoadingPromise;

  tesseractLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) {
        resolve(window.Tesseract);
      } else {
        reject(new Error('Tesseract library failed to initialize'));
      }
    };
    script.onerror = () => reject(new Error('Gagal memuat pustaka OCR Tesseract. Periksa koneksi internet.'));
    document.head.appendChild(script);
  });

  return tesseractLoadingPromise;
}

export async function performOCR(
  imageSource: string | HTMLCanvasElement,
  onProgress?: OCRProgressCallback
): Promise<{ text: string; confidence: number }> {
  const Tesseract = await loadTesseract();

  let src = imageSource;
  if (typeof imageSource !== 'string') {
    src = imageSource.toDataURL('image/png');
  }

  const worker = await Tesseract.createWorker(['ind', 'eng'], 1, {
    logger: (m: any) => {
      if (onProgress) {
        const pct = Math.round((m.progress || 0) * 100);
        if (m.status === 'recognizing text') {
          onProgress(`Mengenali teks: ${pct}%`, pct);
        } else if (m.status) {
          onProgress(`${m.status}...`, pct);
        }
      }
    }
  });

  try {
    const { data } = await worker.recognize(src);
    return {
      text: (data.text || '').trim(),
      confidence: data.confidence || 0
    };
  } finally {
    await worker.terminate();
  }
}
