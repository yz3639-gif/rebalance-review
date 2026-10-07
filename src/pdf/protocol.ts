import type { PdfSnapshot } from './model';
export interface PdfRequest { type: 'render'; id: string; snapshot: PdfSnapshot; chartPng?: string }
export type PdfResponse =
  | { type: 'progress'; id: string; stage: string }
  | { type: 'complete'; id: string; blob: Blob; durationMs: number }
  | { type: 'error'; id: string; message: string };
