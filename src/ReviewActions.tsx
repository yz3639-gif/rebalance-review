import { useState } from 'react';
import { manifestRightsDecision } from './data/rights';
import { download, exportRecord } from './records';
import type { ReviewRecord } from './types';
import PdfActions from './pdf/PdfActions';
import { createPdfSnapshot } from './pdf/model';
import type { PdfInput } from './pdf/model';

export interface ReviewActionsProps extends PdfInput {
  record?: ReviewRecord;
  getRecord?: () => ReviewRecord;
  includeData?: boolean;
  resetEpoch?: number;
  onPrint: () => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}

/** Current and historical reports use the same permissions and frozen export inputs. */
export default function ReviewActions(props: ReviewActionsProps) {
  const [error,setError]=useState('');
  const full=manifestRightsDecision(props.context.manifest,'exportDerived');
  function perform(action:()=>void) {
    try {action();setError('');}
    catch(caught) {const message=caught instanceof Error?caught.message:'The report action could not complete.';setError(message);props.onError?.(message);}
  }
  function exportArchive() {
    const record=props.record??props.getRecord?.();
    if(!record) throw new Error('This review has no complete archive snapshot.');
    const content=exportRecord(record,Boolean(props.includeData));
    download(content,`rebalance-review-${record.createdAt.slice(0,10)}.json`);
    props.onNotice?.('Archive exported. The original review date and permissions are preserved.');
  }
  return <div className="review-actions">
    <div className="button-row">
      <button type="button" className="secondary" disabled={!full.allowed} onClick={()=>perform(exportArchive)}>Export review</button>
      <button type="button" className="quiet" disabled={!full.allowed} onClick={()=>perform(()=>{createPdfSnapshot(props);props.onPrint();})}>Print report</button>
    </div>
    <PdfActions {...props} versions={props.versions??props.record?.versions}/>
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
