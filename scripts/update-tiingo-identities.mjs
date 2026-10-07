/** Refresh factual provider identity only. Never fetch prices or use an API credential. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';

export const TIINGO_DIRECTORY_URL = 'https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip';
export function parseTiingoDirectory(text, symbols) {
  const wanted = new Set(symbols), records = new Map(), required = ['ticker', 'exchange', 'assetType', 'priceCurrency', 'startDate', 'endDate'];
  let headersChecked = false;
  const result = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim(),
    step({ data: row, errors, meta }) {
      if (errors.length) throw new Error('Malformed Tiingo directory CSV');
      if (!headersChecked) {
        if (meta.fields.length !== required.length || !required.every(field => meta.fields.includes(field))) throw new Error('Tiingo directory schema changed');
        headersChecked = true;
      }
      const symbol = row.ticker.trim().toUpperCase();
      if (!wanted.has(symbol)) return;
      const asset = { symbol, exchange: row.exchange.trim().toUpperCase(), assetType: row.assetType.trim(), currency: row.priceCurrency.trim().toUpperCase(),
        hasHistory: /^\d{4}-\d{2}-\d{2}$/.test(row.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(row.endDate) && row.startDate <= row.endDate, ambiguous: false };
      if ([asset.exchange, asset.assetType, asset.currency].some(v => v.length > 100)) throw new Error('Unexpected Tiingo identity field size');
      const previous = records.get(symbol);
      // Bare tickers may occur for multiple securities. Never choose one by CSV order.
      if (previous && JSON.stringify(previous) !== JSON.stringify(asset)) { records.set(symbol, { symbol, exchange: '', assetType: '', currency: '', hasHistory: false, ambiguous: true }); return; }
      records.set(symbol, asset);
    },
  });
  if (result.errors?.length || !headersChecked) throw new Error('Empty or malformed Tiingo directory');
  return [...records.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function main() {
  const catalog = JSON.parse(await readFile(new URL('../src/data/etf-catalog.json', import.meta.url), 'utf8'));
  const response = await fetch(TIINGO_DIRECTORY_URL, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Tiingo directory HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 20_000_000) throw new Error('Tiingo ZIP exceeds size limit'); chunks.push(value); } }
  finally { await reader.cancel(); reader.releaseLock(); }
  const zip = Buffer.concat(chunks), files = unzipSync(zip, { filter(file) { if (file.originalSize > 100_000_000) throw new Error('Tiingo CSV exceeds size limit'); return /\.csv$/i.test(file.name); } });
  if (Object.keys(files).length !== 1) throw new Error('Expected exactly one Tiingo directory CSV');
  const assets = parseTiingoDirectory(new TextDecoder().decode(Object.values(files)[0]), catalog.assets.map(a => a.symbol));
  if (assets.length < catalog.assets.length * .8 || assets.length > catalog.assets.length) throw new Error('Unexpected identity coverage; previous snapshot retained');
  const asOf = new Date().toISOString().slice(0, 10), hash = createHash('sha256').update(zip).digest('hex');
  const snapshot = { schemaVersion: 1, version: `${asOf}-${hash.slice(0, 12)}`, asOf, catalogVersion: catalog.version,
    source: { url: TIINGO_DIRECTORY_URL, sha256: hash, documentation: 'https://www.tiingo.com/documentation/end-of-day' },
    sourceNotes: 'Factual Tiingo symbol metadata only; no prices or access entitlement. Reservations are not usable history. Tiingo metadata is not relicensed under the application MIT license. Require live EOD metadata, compatible exchange and complete history independently.', assets };
  console.log(JSON.stringify({ version: snapshot.version, catalogVersion: catalog.version, identities: assets.length, catalogAssets: catalog.assets.length, sha256: hash }));
  if (!process.argv.includes('--write')) return;
  const destination = fileURLToPath(new URL('../src/server/tiingo-identities.json', import.meta.url));
  await writeFile(destination + '.tmp', JSON.stringify(snapshot) + '\n'); await rename(destination + '.tmp', destination);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
