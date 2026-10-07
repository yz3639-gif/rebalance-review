/** Integrity contract for the bundled, licensed PDF font; never trust a partial HTTP 200 body. */
export const PDF_FONT_ASSET = {
  path: 'fonts/RebalanceSansSC-Regular.ttf',
  bytes: 10_596_148,
  sha256: '33942b12371f51fb0fa8986418d17e1023f3139dcbec0b9d8f96b25e24809563',
} as const;

export async function verifyPdfFontBytes(bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength !== PDF_FONT_ASSET.bytes) {
    throw new Error(`The PDF font download is incomplete (${bytes.byteLength.toLocaleString('en-US')} of ${PDF_FONT_ASSET.bytes.toLocaleString('en-US')} bytes).`);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== PDF_FONT_ASSET.sha256) throw new Error('The downloaded PDF font failed its integrity check.');
}

/** One bounded network retry for a damaged body. Permission/network failures remain explicit. */
export async function fetchVerifiedPdfFont(baseUrl: string): Promise<ArrayBuffer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(new URL(PDF_FONT_ASSET.path, baseUrl), { cache: attempt === 0 ? 'default' : 'no-store' });
    if (!response.ok) throw new Error('The local PDF font could not load. Reconnect and retry.');
    const bytes = await response.arrayBuffer();
    try {
      await verifyPdfFontBytes(bytes);
      return bytes;
    } catch (error) {
      if (attempt === 1) throw new Error(`${error instanceof Error ? error.message : 'The PDF font download is invalid.'} A fresh download was also invalid. Reconnect and retry.`);
    }
  }
  throw new Error('The local PDF font could not be verified. Reconnect and retry.');
}
