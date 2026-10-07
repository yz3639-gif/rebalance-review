import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVerifiedPdfFont, PDF_FONT_ASSET, verifyPdfFontBytes } from '../src/pdf/font-integrity';

const font = new Uint8Array(readFileSync(new URL('../public/fonts/RebalanceSansSC-Regular.ttf', import.meta.url)));
const bytes = () => font.slice().buffer;
afterEach(() => vi.unstubAllGlobals());

describe('bundled PDF font transport integrity', () => {
  it('matches the actual licensed font and rejects a truncated HTTP 200 body', async () => {
    expect(font.byteLength).toBe(PDF_FONT_ASSET.bytes);
    await expect(verifyPdfFontBytes(bytes())).resolves.toBeUndefined();
    // Exact premature EOF observed during a concurrent browser run.
    await expect(verifyPdfFontBytes(font.slice(0, 4_683_146).buffer)).rejects.toThrow('incomplete (4,683,146 of 10,596,148 bytes)');
  });

  it('rejects equal-length corrupted bytes instead of relying on Content-Length', async () => {
    const corrupted = font.slice(); corrupted[corrupted.length - 1] ^= 1;
    await expect(verifyPdfFontBytes(corrupted.buffer)).rejects.toThrow('integrity check');
  });

  it('recovers once from truncation without ever returning unverified bytes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(font.slice(0, 4_683_146)))
      .mockResolvedValueOnce(new Response(bytes()));
    vi.stubGlobal('fetch', fetchMock);
    const recovered = await fetchVerifiedPdfFont('https://review.example/');
    await expect(verifyPdfFontBytes(recovered)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => call[1].cache)).toEqual(['default', 'no-store']);
  });

  it('stops after the second damaged body and does not retry permission errors', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(font.slice(0, 64))));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchVerifiedPdfFont('https://review.example/')).rejects.toThrow('A fresh download was also invalid');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(fetchVerifiedPdfFont('https://review.example/')).rejects.toThrow('could not load');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
