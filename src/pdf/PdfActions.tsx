import { useEffect, useRef, useState } from 'react';
import { createPdfSnapshot, pdfMode } from './model';
import type { PdfInput } from './model';
import type { PdfRequest, PdfResponse } from './protocol';
// Keep chart code in the app graph: browsers cache rejected dynamic module loads,
// so a transient lazy-chart failure cannot be retried without losing this session.
// The larger PDF renderer and fonts still load only inside the dedicated worker.
import { createPdfChart } from './chart';
import './pdf.css';

export default function PdfActions(props: PdfInput & { resetEpoch?: number }) {
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ url: string; filename: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = useRef<string | null>(null);
  const active = useRef(false);

  function releaseUrl() { if (url.current) URL.revokeObjectURL(url.current); url.current = null; }
  function cleanup() {
    generation.current++;
    active.current = false;
    worker.current?.terminate(); worker.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    releaseUrl();
  }
  useEffect(() => {
    cleanup(); setBusy(false); setStage(''); setError(''); setLink(null);
    return cleanup;
    // Reset events and new calculation identities invalidate prior download snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetEpoch, props.result.id]);

  function fail(message: string) {
    cleanup(); setBusy(false); setLink(null); setStage('');
    setError(`PDF unavailable: ${message} Your inputs and review remain available.`);
  }
  async function generate() {
    if (active.current) return;
    let request = '';
    let run = 0;
    try {
      const snapshot = createPdfSnapshot(props);
      active.current = true;
      run = ++generation.current;
      request = `${snapshot.id}-${run}`;
      setBusy(true); setError(''); setLink(null); releaseUrl();
      setStage('Preparing a frozen copy of your review…');
      timer.current = setTimeout(() => { if (run === generation.current) fail('Generation exceeded 30 seconds. Reconnect or try again.'); }, 30000);
      let chartPng: string | undefined;
      if (snapshot.mode === 'full') {
        setStage('Preparing the report chart…');
        chartPng = await createPdfChart(snapshot.result.history);
      }
      if (run !== generation.current) return;
      if (!worker.current) worker.current = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'rebalance-pdf' });
      const current = worker.current;
      current.onmessage = ({ data }: MessageEvent<PdfResponse>) => {
        if (run !== generation.current || data.id !== request) return;
        if (data.type === 'progress') { setStage(data.stage); return; }
        if (data.type === 'error') { fail(data.message); return; }
        if (timer.current) clearTimeout(timer.current); timer.current = null;
        active.current = false; setBusy(false);
        const filename = `rebalance-${snapshot.mode === 'full' ? 'review' : 'decision'}-${snapshot.createdAt.slice(0, 10)}.pdf`;
        const objectUrl = URL.createObjectURL(data.blob); url.current = objectUrl;
        const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = filename;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setLink({ url: objectUrl, filename });
        setStage('PDF generated; download started. Use the download link again if your browser did not save it.');
      };
      current.onerror = event => { event.preventDefault(); if (run === generation.current) fail('The PDF engine could not load or was blocked. Reconnect and retry.'); };
      const message: PdfRequest = { type: 'render', id: request, snapshot, chartPng };
      current.postMessage(message);
    } catch (caught) {
      if (run && run !== generation.current) return;
      fail(caught instanceof Error ? caught.message : 'Unexpected generation error.');
    }
  }
  const mode = pdfMode(props.context);
  return <div className="pdf-actions">
    <div className="button-row"><button type="button" className="secondary" onClick={() => void generate()} disabled={busy}>{mode === 'full' ? 'Download PDF report' : 'Download decision-only PDF'}</button>
      {busy && <button type="button" className="quiet" onClick={() => { cleanup(); setBusy(false); setLink(null); setStage('PDF generation cancelled. Your review is unchanged.'); }}>Cancel PDF</button>}
      {link && <a className="quiet" href={link.url} download={link.filename}>Download generated PDF again</a>}
    </div>
    {mode === 'decision-only' && <p className="hint">These source permissions do not allow a full report export. The PDF includes your allocation inputs, selected assumptions and reasoning; market data and analytical results are excluded.</p>}
    {stage && <p className="hint" role="status">{stage}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
