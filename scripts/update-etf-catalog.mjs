/** Refresh factual symbol-directory metadata; never price data or historical-universe claims. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const sources = ['nasdaqlisted', 'otherlisted'].map(name => `https://www.nasdaqtrader.com/dynamic/SymDir/${name}.txt`);
const exchanges = { A: 'NYSE American', N: 'NYSE', P: 'NYSE Arca', Z: 'Cboe BZX', V: 'IEX', L: 'LTSE', T: 'Nasdaq Texas' };
export function parseDirectory(text, source) {
  const lines = text.trim().split(/\r?\n/), headers = lines.shift().split('|');
  if (!['ETF', 'Test Issue', 'Security Name'].every(h => headers.includes(h))) throw new Error('Directory required fields changed');
  const footer = lines.pop();
  if (!/^File Creation Time: \d{8}\d{2}:\d{2}\|/.test(footer)) throw new Error('Missing directory freshness footer');
  const assets = [];
  for (const line of lines) {
    const cells = line.split('|'); if (cells.length !== headers.length) throw new Error('Malformed directory row');
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
    if (!['Y', 'N'].includes(row.ETF) || !['Y', 'N'].includes(row['Test Issue'])) throw new Error('Unknown directory flag');
    if (row.ETF !== 'Y' || row['Test Issue'] !== 'N') continue;
    const symbol = row.Symbol || row['ACT Symbol'];
    if (!/^[A-Z0-9][A-Z0-9._-]{0,24}$/.test(symbol) || !row['Security Name'].trim()) throw new Error('Unexpected ETF symbol or name');
    assets.push({ symbol, name: row['Security Name'], exchange: row.Symbol ? 'Nasdaq' : exchanges[row.Exchange] || row.Exchange, source });
  }
  return { assets, fileCreatedAt: footer.split('|')[0].replace('File Creation Time: ', '') };
}
export function compareCatalog(previous, next) {
  const before = new Map(previous.assets.map(a => [a.symbol, a])), after = new Map(next.assets.map(a => [a.symbol, a]));
  return { added: [...after.keys()].filter(s => !before.has(s)), removed: [...before.keys()].filter(s => !after.has(s)), changed: [...after.keys()].filter(s => before.has(s) && JSON.stringify(before.get(s)) !== JSON.stringify(after.get(s))) };
}
async function main() {
  const destination = fileURLToPath(new URL('../src/data/etf-catalog.json', import.meta.url));
  const responses = await Promise.all(sources.map(async (url, source) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Directory HTTP ${response.status}`);
    const text = await response.text(); if (text.length > 5_000_000) throw new Error('Directory exceeds size bound');
    return { ...parseDirectory(text, source), url, sha256: createHash('sha256').update(text).digest('hex') };
  }));
  const assets = responses.flatMap(r => r.assets).sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (assets.length < 1000 || new Set(assets.map(a => a.symbol)).size !== assets.length) throw new Error('Unexpected directory size or conflicting duplicate symbols; previous snapshot retained');
  const asOf = new Date().toISOString().slice(0, 10);
  const output = { schemaVersion: 1, version: `${asOf}-${createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12)}`, asOf,
    sourceNotes: 'Current Nasdaq ETF-flagged non-test listings. Includes exchange-traded products. Listing identity only: no verification of inception, currency, leverage, provider availability, or historical universe. Nasdaq data is not relicensed under the application MIT license.',
    sources: responses.map(({ url, sha256, fileCreatedAt }) => ({ url, sha256, fileCreatedAt })), assets };
  let previous; try { previous = JSON.parse(await readFile(destination, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const changes = previous ? compareCatalog(previous, output) : { added: assets.map(a => a.symbol), removed: [], changed: [] };
  console.log(JSON.stringify({ version: output.version, count: assets.length, ...changes }));
  if (!process.argv.includes('--write')) return;
  if (previous && (changes.removed.length > previous.assets.length * .1 || Math.abs(assets.length - previous.assets.length) > previous.assets.length * .2)) throw new Error('Large catalog change requires investigation; previous snapshot retained');
  await writeFile(destination + '.tmp', JSON.stringify(output) + '\n'); await rename(destination + '.tmp', destination);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(error => { console.error(error.message); process.exitCode = 1; });
