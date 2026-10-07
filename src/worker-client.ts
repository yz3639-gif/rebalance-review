import bundledWorkerUrl from './review.worker?worker&url';

let pending: Promise<string> | null = null;
/** Only executable app code is held in memory. No holdings, prices, or credentials are cached. */
export function preloadCompute(): Promise<string> {
  // Development Workers import Vite modules by URL and must retain their HTTP base.
  if (import.meta.env.DEV) return Promise.resolve(bundledWorkerUrl);
  if(!pending) pending=fetch(bundledWorkerUrl,{credentials:'omit',signal:AbortSignal.timeout(30000)})
    .then(async response=>{if(!response.ok)throw new Error('Calculation assets could not be loaded. Reconnect once, then try again.');return URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'}));})
    .catch(error=>{pending=null;throw error;});
  return pending;
}
