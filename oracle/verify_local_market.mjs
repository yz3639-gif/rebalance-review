/** Private fixture bridge: never publishes inputs or results and does not start an HTTP listener. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [requestPath, outputPath] = process.argv.slice(2);
if (!requestPath || !outputPath) throw new Error('Supply private request and output paths.');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
try {
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  const { parseMarketCsv } = await server.ssrLoadModule('/src/data/market.ts');
  const { computeReview } = await server.ssrLoadModule('/src/engine/index.ts');
  const dataset = parseMarketCsv(await readFile(resolve(request.csvPath), 'utf8'), { format: 'wide', manifest: request.manifest });
  const result = computeReview({ ...request.settings, dataset });
  await writeFile(outputPath, JSON.stringify(result), { mode: 0o600 });
} finally {
  await server.close();
}
