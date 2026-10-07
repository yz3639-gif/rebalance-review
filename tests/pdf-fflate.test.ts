import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzlib, zlibSync } from '../src/pdf/fflate';

afterEach(() => vi.unstubAllGlobals());
const bytes = new TextEncoder().encode('A lossless PNG can be decoded within the existing PDF worker. 中文');

describe('PDF worker zlib adapter', () => {
  it('decodes asynchronously without creating another Worker and preserves reexports', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('No nested worker permitted'); } });
    let synchronous = true;
    const decoded = new Promise<Uint8Array>((resolve, reject) => {
      unzlib(zlibSync(bytes), (error, data) => {
        expect(synchronous).toBe(false);
        if (error) reject(error); else resolve(data);
      });
    });
    synchronous = false;
    expect(await decoded).toEqual(bytes);
  });

  it('snapshots input and supports dictionary and output-size options', async () => {
    const dictionary = bytes.slice(0, 30), input = zlibSync(bytes, { dictionary });
    const decoded = new Promise<Uint8Array>((resolve, reject) => unzlib(input, { dictionary, size: bytes.length }, (error, data) => error ? reject(error) : resolve(data)));
    input.fill(0); dictionary.fill(0);
    expect(await decoded).toEqual(bytes);
  });

  it('honors consume and cancellation before decompression begins', async () => {
    const input = zlibSync(bytes), callback = vi.fn();
    const cancel = unzlib(input, { consume: true }, callback);
    expect(input.byteLength).toBe(0);
    cancel(); await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
  });

  it('reports malformed input through the callback exactly once', async () => {
    const callback = vi.fn();
    unzlib(new Uint8Array([1, 2, 3]), callback);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(callback.mock.calls[0][1]).toBeUndefined();
  });
});
