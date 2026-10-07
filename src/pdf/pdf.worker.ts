import { Buffer } from 'buffer/';
import type { PdfRequest, PdfResponse } from './protocol';
import { pdfBlobFromStream } from './stream';

// Upstream image/font browser modules still use Buffer. Scope the shim to this lazy worker.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
const scope = self as unknown as { location: Location; onmessage: ((event: MessageEvent<PdfRequest>) => void) | null; postMessage: (message: PdfResponse) => void };
scope.onmessage = async ({ data }) => {
  if (data.type !== 'render') return;
  const start = performance.now();
  try {
    scope.postMessage({ type: 'progress', id: data.id, stage: 'Loading the local PDF engine…' });
    const [{ pdf }, { default: PdfDocument }, { initializePdfFont, assertSupportedText }] = await Promise.all([
      import('@react-pdf/renderer'), import('./Document'), import('./fonts'),
    ]);
    scope.postMessage({ type: 'progress', id: data.id, stage: 'Loading the local PDF font…' });
    await initializePdfFont(`${scope.location.origin}/`);
    assertSupportedText(data.snapshot);
    scope.postMessage({ type: 'progress', id: data.id, stage: 'Laying out your PDF report…' });
    const document = PdfDocument({ snapshot: data.snapshot, chartPng: data.chartPng });
    const blob = await pdfBlobFromStream(await pdf(document).toBuffer());
    scope.postMessage({ type: 'complete', id: data.id, blob, durationMs: performance.now() - start });
  } catch (error) {
    scope.postMessage({ type: 'error', id: data.id, message: error instanceof Error ? error.message : 'The PDF could not be generated.' });
  }
};
