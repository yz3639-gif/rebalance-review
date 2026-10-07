import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { pdfBlobFromStream } from '../src/pdf/stream';

it('validates PDF bytes across chunk boundaries without reading the resulting Blob', async () => {
  const expected = `%PDF-1.7\n${'content'.repeat(100)}`;
  const blob = await pdfBlobFromStream(Readable.from([Buffer.from(expected.slice(0, 2)), Buffer.from(expected.slice(2))]));
  expect(blob.type).toBe('application/pdf');
  expect(await blob.text()).toBe(expected);
});

it('rejects incomplete or non-PDF output and propagates stream errors', async () => {
  await expect(pdfBlobFromStream(Readable.from([Buffer.from('%PDF-short')]))).rejects.toThrow('incomplete');
  await expect(pdfBlobFromStream(Readable.from([Buffer.alloc(600)]))).rejects.toThrow('incomplete');
  const stream = new Readable({ read() { this.destroy(new Error('Renderer stopped')); } });
  await expect(pdfBlobFromStream(stream)).rejects.toThrow('Renderer stopped');
});
