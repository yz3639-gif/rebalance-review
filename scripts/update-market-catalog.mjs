/** Materialize only the 50 configured display identities. Offline; no prices, credentials or network. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const catalogUrl = new URL('../src/data/etf-catalog.json', import.meta.url);
const selectionUrl = new URL('../src/demo/market-universe.json', import.meta.url);
const outputUrl = new URL('../src/demo/market-catalog.json', import.meta.url);

/** Read the shared curated selection; never execute or import browser code. */
export function selectedSymbolsFromSource(source) {
  const selection = JSON.parse(source);
  const sleeves = ['US equity', 'Sectors & themes', 'Fixed income', 'Real assets', 'International', 'Leveraged & inverse'];
  if (!Array.isArray(selection) || selection.length !== sleeves.length || new Set(selection.map(group => group?.sleeve)).size !== sleeves.length) {
    throw new Error('The display universe must contain the six distinct configured asset groups.');
  }
  const symbols = selection.flatMap(group => {
    if (!group || !sleeves.includes(group.sleeve) || !/^#[\dA-F]{6}$/i.test(group.color) || !Array.isArray(group.assets)) {
      throw new Error('Each asset group must have a known sleeve, color and asset tuples.');
    }
    return group.assets.map(tuple => {
      if (!Array.isArray(tuple) || tuple.length !== 2 || tuple.some(value => typeof value !== 'string' || !value.trim())) {
        throw new Error('Display assets must be [symbol, shortName] tuples.');
      }
      return tuple[0];
    });
  });
  if (symbols.length !== 50 || new Set(symbols).size !== 50 || symbols.some(symbol => !/^[A-Z0-9][A-Z0-9.\-]*$/.test(symbol))) {
    throw new Error('The display basket must contain exactly 50 distinct canonical symbols.');
  }
  return symbols;
}

export function buildMarketCatalog(catalogText, selectionText) {
  const source = JSON.parse(catalogText), symbols = selectedSymbolsFromSource(selectionText);
  if (source.schemaVersion !== 1 || typeof source.version !== 'string' || !source.version ||
    !/^\d{4}-\d{2}-\d{2}$/.test(source.asOf) || typeof source.sourceNotes !== 'string' ||
    !Array.isArray(source.sources) || !source.sources.length || !Array.isArray(source.assets)) {
    throw new Error('The authoritative ETF catalog schema is invalid.');
  }
  if (source.sources.some(item => typeof item.url !== 'string' || !item.url.startsWith('https://') ||
    !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.fileCreatedAt !== 'string')) {
    throw new Error('The authoritative catalog must preserve source URLs, hashes and timestamps.');
  }
  const bySymbol = new Map(source.assets.map(asset => [asset.symbol, asset]));
  if (bySymbol.size !== source.assets.length) throw new Error('The authoritative catalog contains duplicate identities.');
  const assets = symbols.map(symbol => {
    const asset = bySymbol.get(symbol);
    if (!asset || typeof asset.name !== 'string' || !asset.name.trim() || typeof asset.exchange !== 'string' ||
      !Number.isInteger(asset.source) || !source.sources[asset.source]) throw new Error(`Catalog identity unavailable for ${symbol}.`);
    return { symbol: asset.symbol, name: asset.name, exchange: asset.exchange, source: asset.source };
  });
  return { schemaVersion: 1, version: source.version, asOf: source.asOf,
    sourceName: 'Nasdaq symbol directories: ETF-flagged non-test listings',
    sourceCatalog: 'src/data/etf-catalog.json', sourceCatalogSha256: sha256(catalogText),
    selectionSource: 'src/demo/market-universe.json', selectionSha256: sha256(selectionText),
    sourceNotes: source.sourceNotes, sources: source.sources, assets };
}

export function serializeMarketCatalog(snapshot) { return JSON.stringify(snapshot, null, 2) + '\n'; }
export function assertMarketCatalogCurrent(actual, expected) {
  if (actual !== expected) throw new Error('Market Pulse identity snapshot is stale. Run node scripts/update-market-catalog.mjs and review the generated change.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: node scripts/update-market-catalog.mjs [--check]');
  const [catalogText, selectionText] = await Promise.all([readFile(catalogUrl, 'utf8'), readFile(selectionUrl, 'utf8')]);
  const snapshot = buildMarketCatalog(catalogText, selectionText), expected = serializeMarketCatalog(snapshot);
  if (args.includes('--check')) {
    const actual = await readFile(outputUrl, 'utf8');
    assertMarketCatalogCurrent(actual, expected);
    console.log(`Market Pulse catalog current: ${snapshot.assets.length} assets, ${snapshot.version}, as of ${snapshot.asOf}.`);
  } else {
    const temporary = fileURLToPath(outputUrl) + '.tmp';
    await writeFile(temporary, expected); await rename(temporary, outputUrl);
    console.log(`Market Pulse catalog written: ${snapshot.assets.length} assets, ${snapshot.version}, as of ${snapshot.asOf}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
