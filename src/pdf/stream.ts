/** Validate renderer bytes before constructing a Blob. WebKit's offline mode
 * rejects Blob.text()/arrayBuffer() even for freshly generated local content. */
export function pdfBlobFromStream(stream: NodeJS.ReadableStream): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    stream.on('data', (chunk: Uint8Array) => {
      const copy = new Uint8Array(chunk);
      chunks.push(copy);
      size += copy.byteLength;
    });
    stream.once('error', reject);
    stream.once('end', () => {
      const prefix: number[] = [];
      for (const chunk of chunks) {
        for (let i = 0; i < chunk.length && prefix.length < 5; i++) prefix.push(chunk[i]);
        if (prefix.length === 5) break;
      }
      if (size < 500 || String.fromCharCode(...prefix) !== '%PDF-') {
        reject(new Error('The generated PDF was incomplete.'));
        return;
      }
      resolve(new Blob(chunks, { type: 'application/pdf' }));
    });
  });
}
