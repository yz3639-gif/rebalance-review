import { Font } from '@react-pdf/renderer';
import type { PdfSnapshot } from './model';
import { fetchVerifiedPdfFont } from './font-integrity';

export const PDF_FONT_FAMILY = 'RebalanceSansSC';
let initialized: Promise<void> | null = null;
let ranges: number[][] = [];

export function initializePdfFont(baseUrl: string): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const response = await fetch(new URL('fonts/glyph-ranges.json', baseUrl));
      if (!response.ok) throw new Error('The PDF character coverage file could not load. Reconnect and retry.');
      ranges = await response.json() as number[][];
      if (!Array.isArray(ranges) || !ranges.length) throw new Error('The PDF character coverage file is invalid.');
      const bytes = await fetchVerifiedPdfFont(baseUrl);
      const fontUrl = URL.createObjectURL(new Blob([bytes], { type: 'font/ttf' }));
      try {
        Font.register({ family: PDF_FONT_FAMILY, src: fontUrl });
        // Font.load retains the decoded font; the temporary URL is no longer needed.
        await Font.load({ fontFamily: PDF_FONT_FAMILY });
      } finally { URL.revokeObjectURL(fontUrl); }
    })().catch(error => { initialized = null; throw error; });
  }
  return initialized;
}

export function assertSupportedText(snapshot: PdfSnapshot) {
  const text = [snapshot.id, snapshot.rationale, snapshot.a.name, snapshot.b.name,
    ...snapshot.a.holdings.map(h => h.symbol), ...snapshot.b.holdings.map(h => h.symbol),
    ...(snapshot.mode === 'full' ? [snapshot.manifest.source, ...snapshot.result.warnings,snapshot.catalog?.version??'',...Object.values(snapshot.versions??{})] : []),
  ].join('\n');
  const unsupported = [...new Set([...text].filter(character => {
    const n = character.codePointAt(0)!;
    return n !== 9 && n !== 10 && n !== 13 && !ranges.some(([a, b]) => n >= a && n <= b);
  }))];
  if (unsupported.length) {
    throw new Error(`The PDF font cannot display these characters: ${unsupported.slice(0, 8).join(' ')}. Edit those characters before downloading; your original text has been kept.`);
  }
}
