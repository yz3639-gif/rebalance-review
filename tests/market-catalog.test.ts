import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import catalog from '../src/data/etf-catalog.json';
import subset from '../src/demo/market-catalog.json';
import { MARKET_ASSETS, REPLAY_META } from '../src/demo/replayFeed';
import { assertMarketCatalogCurrent, buildMarketCatalog, selectedSymbolsFromSource, serializeMarketCatalog } from '../scripts/update-market-catalog.mjs';

const root = new URL('../', import.meta.url);
const sourceText = readFileSync(new URL('src/data/etf-catalog.json', root), 'utf8');
const selectionText = readFileSync(new URL('src/demo/market-universe.json', root), 'utf8');
const replaySource = readFileSync(new URL('src/demo/replayFeed.ts', root), 'utf8');
const generatedText = readFileSync(new URL('src/demo/market-catalog.json', root), 'utf8');

describe('minimal public demo identity catalog', () => {
  it('exactly preserves the 50 configured identities in order without retaining unrelated assets', () => {
    const selected = selectedSymbolsFromSource(selectionText);
    expect(selected).toEqual(MARKET_ASSETS.map(asset => asset.symbol));
    expect(subset.assets).toEqual(selected.map((symbol: string) => catalog.assets.find(asset => asset.symbol === symbol)));
    expect(subset.assets).toHaveLength(50);
    expect(Buffer.byteLength(generatedText)).toBeLessThan(20_000);
    expect(replaySource).not.toMatch(/from ['"]\.\.\/data\//);
  });
  it('retains catalog date, version, provenance hashes and source limitations', () => {
    expect(subset.version).toBe(catalog.version); expect(subset.asOf).toBe(catalog.asOf);
    expect(subset.sources).toEqual(catalog.sources); expect(subset.sourceNotes).toBe(catalog.sourceNotes);
    expect(subset.sourceCatalogSha256).toBe(createHash('sha256').update(sourceText).digest('hex'));
    expect(REPLAY_META.catalogVersion).toBe(catalog.version); expect(REPLAY_META.catalogAsOf).toBe(catalog.asOf);
    expect(REPLAY_META.catalogSourceName).toContain('Nasdaq'); expect(REPLAY_META.catalogSources).toEqual(catalog.sources);
  });
  it('regenerates exactly and passes the read-only command-line check', () => {
    expect(serializeMarketCatalog(buildMarketCatalog(sourceText, selectionText))).toBe(generatedText);
    expect(execFileSync(process.execPath, ['scripts/update-market-catalog.mjs', '--check'], { cwd: root, timeout: 15_000, encoding: 'utf8' })).toContain('50 assets');
  });
  it('fails the stale check when source names or provenance change', () => {
    const changed = structuredClone(catalog); changed.assets.find(asset => asset.symbol === 'SPY')!.name += ' revised';
    const next = serializeMarketCatalog(buildMarketCatalog(JSON.stringify(changed), selectionText));
    expect(() => assertMarketCatalogCurrent(generatedText, next)).toThrow(/stale/);
  });
  it('rejects missing, duplicate or unrecognized selections instead of silently dropping them', () => {
    const missing = { ...catalog, assets: catalog.assets.filter(asset => asset.symbol !== 'SPY') };
    expect(() => buildMarketCatalog(JSON.stringify(missing), selectionText)).toThrow(/SPY/);
    expect(() => selectedSymbolsFromSource(selectionText.replace('"QQQ"', '"SPY"'))).toThrow(/50 distinct/);
    expect(() => selectedSymbolsFromSource('{}')).toThrow(/six distinct/);
  });
});
