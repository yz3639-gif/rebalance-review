import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { computeReview, eulerRisk, ledoitWolf, simulateLedger } from '../src/engine';
import type { ReviewSpec } from '../src/types';
import { MAX_REVIEW_ASSETS, SUPPORTED_SYMBOLS } from '../src/data/registry';

it.skipIf(process.env.RUN_ENGINE_BENCHMARK !== '1')('records 30 warm A/B runs at 50 assets × 5000 days', () => {
  const symbols = SUPPORTED_SYMBOLS.slice(0, MAX_REVIEW_ASSETS);
  const dates: string[] = [], date = new Date('2006-01-02T00:00:00Z');
  while (dates.length < 5000) {
    if (![0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  const prices = dates.map((_, i) => Array.from({ length: MAX_REVIEW_ASSETS }, (_, j) => 100 * Math.exp(.00015 * i + .12 * Math.sin(i * .037 + j * .2))));
  const returns = prices.slice(1).map((row, i) => row.map((v, j) => v / prices[i][j] - 1));
  const targetA = Array.from({ length: MAX_REVIEW_ASSETS }, () => .8 / MAX_REVIEW_ASSETS), targetB = Array.from({ length: MAX_REVIEW_ASSETS }, (_, j) => (j + 1) * .9 / 1275);
  const numericWorkload = () => {
    for (const window of [126, 252, 504]) {
      const cov = ledoitWolf(returns.slice(-window));
      eulerRisk(targetA, cov, targetA.map((_, i) => `ASSET${i}`)); eulerRisk(targetB, cov, targetB.map((_, i) => `ASSET${i}`));
    }
    for (const target of [targetA, targetB]) {
      for (const cost of [2, 5, 10, 20]) simulateLedger(dates, prices, target, 'monthly', cost, 100000);
      simulateLedger(dates, prices, target, 'monthly', 5, 100000, 2);
    }
  };
  const spec: ReviewSpec = {
    a: { id: 'a', name: 'A', holdings: symbols.map(symbol => ({ symbol, weight: 1 / MAX_REVIEW_ASSETS })) },
    b: { id: 'b', name: 'B', holdings: symbols.map((symbol, i) => ({ symbol, weight: (i + 1) / 1275 })) },
    dataset: { dates, symbols, prices, manifest: {
      id: 'synthetic-performance', source: 'Synthetic benchmark', currency: 'USD', basis: 'total_return_index', synthetic: true, asOf: dates.at(-1)!,
      rights: { display: true, rawPersistence: true, derivedPersistence: true, export: true, publicDisplay: true, evidence: 'Local synthetic benchmark', verifiedAt: '2026-10-05' },
    } }, frequency: 'monthly', costBps: 5, initialNav: 100000, cashReturnConfirmed: true, partialCoverageConfirmed: false,
  };
  const measure = (action: () => unknown) => {
    for (let i = 0; i < 3; i++) action();
    const samples = Array.from({ length: 30 }, () => { const start = performance.now(); action(); return performance.now() - start; });
    const sorted = [...samples].sort((a, b) => a - b);
    return { runs: 30, warmup: 3, milliseconds: samples, p50: sorted[14], p95: sorted[28], maximum: sorted[29] };
  };
  const result = {
    version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    sourceSha256: Object.fromEntries(['tests/engine.performance.test.ts', 'src/engine/index.ts', 'src/engine/covariance.ts', 'src/engine/ledger.ts', 'src/data/etf-catalog.json'].map(path => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')])),
    generatedAt: new Date().toISOString(), environment: { runtime: process.version, platform: os.platform(), architecture: os.arch(), memoryBytes: os.totalmem(), cpu: os.cpus()[0]?.model },
    note: 'Node numerical-kernel timing on this machine only; does not certify a 16GB browser/mobile baseline. Supported-symbol product review is separate from 50-asset kernel capacity.',
    numeric50Assets5000Days: measure(numericWorkload), supported50Assets5000InputDaysWithFiveYearCap: measure(() => computeReview(spec)),
  };
  writeFileSync(process.env.ENGINE_BENCHMARK_OUTPUT || new URL('../oracle/performance-v1.2.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  expect(result.numeric50Assets5000Days.p95).toBeLessThanOrEqual(2000);
}, 120000);
