import { unzlibSync } from 'fflate/browser';
import type { AsyncTerminable, AsyncUnzlibOptions, FlateCallback, FlateError } from 'fflate/browser';

export * from 'fflate/browser';

// png-js otherwise starts a Blob child worker per PNG. WebKit cannot start that
// worker offline. PDF work already runs off the UI thread, so use the upstream
// synchronous decoder there while retaining its asynchronous callback contract.
export function unzlib(data: Uint8Array, callback: FlateCallback): AsyncTerminable;
export function unzlib(data: Uint8Array, options: AsyncUnzlibOptions, callback: FlateCallback): AsyncTerminable;
export function unzlib(data: Uint8Array, optionsOrCallback: AsyncUnzlibOptions | FlateCallback, suppliedCallback?: FlateCallback): AsyncTerminable {
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback;
  if (typeof callback !== 'function') throw new TypeError('A decompression callback is required.');
  // Snapshot immediately, matching the upstream postMessage copy/transfer.
  const input = options.consume ? structuredClone(data, { transfer: [data.buffer as ArrayBuffer] }) : data.slice();
  const dictionary = options.dictionary?.slice();
  const size = options.size;
  let cancelled = false;
  queueMicrotask(() => {
    if (cancelled) return;
    let output: Uint8Array<ArrayBuffer> | undefined;
    let failure: FlateError | null = null;
    try {
      output = unzlibSync(input, { dictionary, out: size ? new Uint8Array(size) : undefined });
    } catch (error) {
      failure = error as FlateError;
    }
    // A callback exception must propagate once, rather than invoke it a second time.
    if (!cancelled) callback(failure, output!);
  });
  return () => { cancelled = true; };
}
