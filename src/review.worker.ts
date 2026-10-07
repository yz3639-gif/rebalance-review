import { computeReview } from './engine';
import type { ReviewSpec } from './types';
self.onmessage = (event: MessageEvent<ReviewSpec>) => {
  try { self.postMessage({ ok: true, result: computeReview(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Calculation failed. Check the data and try again.' }); }
};
