import type { DataRights, DatasetManifest } from '../types';
import { currentUsDate, DataValidationError, hasCredentialMaterial, isIsoDate, unknownRights } from './validation';

export type RightsAction = 'display' | 'persistRaw' | 'persistDerived' | 'exportRaw' | 'exportDerived' | 'publicDisplay';
export interface RightsDecision { allowed: boolean; reason: string }

export function rightsDecision(rights: DataRights | undefined, action: RightsAction): RightsDecision {
  if (!rights || typeof rights.evidence !== 'string' || !rights.evidence.trim() || typeof rights.verifiedAt !== 'string' || !isIsoDate(rights.verifiedAt) || rights.verifiedAt > currentUsDate()) {
    return { allowed: false, reason: 'Source permissions are unknown or lack dated evidence. This action is disabled.' };
  }
  if (hasCredentialMaterial(rights.evidence)) return { allowed: false, reason: 'Remove credentials from source permission evidence before using or storing this dataset.' };
  const permissions: Record<RightsAction, boolean> = {
    display: rights.display,
    persistRaw: rights.display && rights.rawPersistence,
    persistDerived: rights.display && rights.derivedPersistence,
    exportRaw: rights.display && rights.export && rights.rawPersistence,
    exportDerived: rights.display && rights.export && rights.derivedPersistence,
    publicDisplay: rights.display && rights.publicDisplay,
  };
  return { allowed: permissions[action] === true, reason: permissions[action] === true ? 'Permitted by the recorded source-specific evidence.' : `The recorded source permissions do not allow ${action}.` };
}

export function manifestRightsDecision(manifest: DatasetManifest, action: RightsAction): RightsDecision {
  if (manifest.policy === 'tiingo-byok' && action !== 'display') return {allowed:false,reason:'Tiingo BYOK is calculation-only. Persistence and full-report exports have not been authorized.'};
  if (manifest.policy === 'yahoo-local' && action !== 'display') return {allowed:false,reason:'Yahoo Finance local research is calculation-only. Persistence, full-report exports and public display have not been authorized.'};
  if (['operation','session'].includes(manifest.retention || '') && ['persistRaw','exportRaw'].includes(action)) return {allowed:false,reason:'This source does not permit raw prices to outlive the calculation or browser session. Raw history cannot be saved or exported.'};
  if (hasCredentialMaterial(manifest.source)) return {allowed:false,reason:'Remove credentials from the source description before using or storing this dataset.'};
  return rightsDecision(manifest.rights,action);
}
export function assertRights(manifest: DatasetManifest, action: RightsAction): void {
  const decision = manifestRightsDecision(manifest,action);
  if (!decision.allowed) throw new DataValidationError(decision.reason);
}

/** A user must record the rights that apply to this specific local file; no broad licensing inference. */
export function localFileRights(evidence: string, permissions: Partial<Omit<DataRights, 'evidence' | 'verifiedAt'>>, verifiedAt: string): DataRights {
  return { ...unknownRights(), ...permissions, evidence, verifiedAt };
}

export const TIINGO_STATUS = Object.freeze({
  enabled: true,
  reason: 'User-owned API key via a restricted same-origin adapter. Calculation-only; no shared key, persistent prices or full-report exports. Actual account access depends on the supplied key and provider plan.',
  termsUrl: 'https://app.tiingo.com/tos/',
  checkedAt: '2026-10-06',
});
