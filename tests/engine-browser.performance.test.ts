import { expect, it } from 'vitest';

it.skipIf(process.env.RUN_BROWSER_ENGINE_BENCHMARK !== '1')('benchmarks frozen production Worker in Chromium, Firefox and WebKit', async () => {
  // The production build and preview server must already exist; this test never builds or restarts them.
  const { runBrowserPerformance } = await import('../oracle/browser-performance.mjs');
  const result = await runBrowserPerformance(process.env.BROWSER_PERF_BASE_URL || 'http://127.0.0.1:4173');
  expect(result.browsers).toHaveLength(3);
  for (const browser of result.browsers) {
    expect(browser.status).toBe('passed');
    expect(browser.supported50WarmP95Within2Seconds).toBe(true);
    expect(browser.supported50FreshWorkerP95Within2Seconds).toBe(true);
  }
}, 180000);
