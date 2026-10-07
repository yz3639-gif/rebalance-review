import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../ErrorBoundary';
const DesignApp = lazy(() => import('./DesignApp'));
const ConnectedApp = lazy(() => import('./ConnectedApp'));
const isSample = new URLSearchParams(location.search).has('sample');
createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary scope="research workspace"><Suspense fallback={<div role="status" style={{ padding: 32, color: '#edf1f7', fontFamily: 'sans-serif' }}>Opening the research workspace…</div>}>{isSample ? <DesignApp /> : <ConnectedApp />}</Suspense></ErrorBoundary></StrictMode>,
);
