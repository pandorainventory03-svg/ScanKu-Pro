export interface Point {
  x: number;
  y: number;
}

export interface QuadCorners {
  tl: Point; // Top-left
  tr: Point; // Top-right
  br: Point; // Bottom-right
  bl: Point; // Bottom-left
}

export type ScanFilterMode = 'color' | 'bw' | 'grayscale' | 'original';

export interface DetectionResult {
  corners: QuadCorners;
  confidence: number;
  isDocumentDetected: boolean;
  areaPercent: number;
}

export interface ScanHistoryItem {
  id?: number;
  title: string;
  original: string; // Data URL
  scanned: string;  // Data URL
  mode: ScanFilterMode;
  timestamp: string;
  pageCount?: number;
}

export interface OCRResult {
  text: string;
  confidence?: number;
}
