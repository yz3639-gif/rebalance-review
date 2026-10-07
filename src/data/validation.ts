import { z } from '../schema';
import { MAX_REVIEW_ASSETS } from './registry';
import type { DataRights, DatasetManifest } from '../types';

export class DataValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[] | string) {
    const list = Array.isArray(issues) ? issues : [issues];
    super(list.join('\n'));
    this.name = 'DataValidationError';
    this.issues = list;
  }
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** ETF cutoff and rights dates use the market's civil day, not the UTC rollover. */
export function currentUsDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const credentialNames = /^(?:api(?:key|token)|access(?:key|token)|auth(?:entication|orization)?|bearer|token|key|password|secret|clientsecret|subscriptionkey|xapikey|xauthtoken|xamz(?:credential|signature|securitytoken)|signature|sig|credentials?|jwt|sessiontoken|securitytoken|sastoken)$/i;
/** URL encoding is representation, not redaction. Decode bounded nested encodings too. */
function decodedCredentialVariants(text: string): { variants: string[]; invalid: boolean } {
  const variants = [text];let invalid=false;
  for (let depth = 0; depth < 8; depth++) {
    const decoded = variants.at(-1)!.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
      try { return decodeURIComponent(encoded); } catch { invalid=true;return encoded; }
    });
    if (decoded === variants.at(-1)) break;
    variants.push(decoded);
  }
  return {variants,invalid};
}
/** Check the separate secret against nonsecret configuration, including URL/form encodings. */
export function containsCredential(text: string, credential: string): boolean {
  if (!credential) return false;
  const {variants,invalid} = decodedCredentialVariants(text);
  if(invalid)return true;
  // Deeply nested encodings are not supported as nonsecret configuration.
  if (variants.length === 9 && /%[0-9a-f]{2}/i.test(variants.at(-1)!)) return true;
  return variants.some(value => value.includes(credential) || value.replace(/\+/g, ' ').includes(credential));
}
/** Prevent accidental credentials in source metadata; error messages never repeat the input. */
export function hasCredentialMaterial(text: string): boolean {
  const {variants,invalid} = decodedCredentialVariants(text);
  if(invalid)return true;
  if (variants.length === 9 && /%[0-9a-f]{2}/i.test(variants.at(-1)!)) return true;
  for (const value of variants) {
    if (/\bBearer\s+[A-Za-z0-9._~+/-]+/i.test(value)) return true;
    // Includes copied JSON snippets as well as key=value source descriptions.
    for (const match of value.matchAll(/\b([A-Za-z][A-Za-z0-9_-]*)["']?\s*[:=]\s*\S+/g)) {
      if (credentialNames.test(match[1].replace(/[_-]/g, ''))) return true;
    }
    for (const candidate of value.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
      try {
        const url = new URL(candidate);
        if (url.username || url.password) return true;
        for (const key of url.searchParams.keys()) {
          if (credentialNames.test(key.replace(/[_-]/g, ''))) return true;
        }
      } catch { /* A non-URL source description is allowed; it grants no rights by itself. */ }
    }
  }
  return false;
}

const credentialFree = (value: string) => !hasCredentialMaterial(value);
const credentialMessage = 'Remove credentials from source metadata. Record a public source URL and permission description only.';
const dateSchema = z.string().refine(isIsoDate, 'Use a real calendar date in YYYY-MM-DD format.');
const rightsSchema = z.object({
  display: z.boolean(), rawPersistence: z.boolean(), derivedPersistence: z.boolean(),
  export: z.boolean(), publicDisplay: z.boolean(), evidence: z.string().max(4000).refine(credentialFree, credentialMessage), verifiedAt: z.string(),
}).strict();

export const datasetManifestSchema = z.object({
  id: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(1000).refine(credentialFree, credentialMessage),
  currency: z.literal('USD'), basis: z.enum(['adjusted_close', 'total_return_index', 'cash_zero']),
  asOf: dateSchema, synthetic: z.boolean(), rights: rightsSchema,
  retention: z.enum(['operation', 'session', 'persistable']).optional(),
  policy: z.enum(['tiingo-byok','yahoo-local','user-declared','cash-model']).optional(),
  acquisition: z.object({
    requestedStart: dateSchema, requestedEnd: dateSchema,
    assets: z.array(z.object({ symbol: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,24}$/), firstDate: dateSchema, lastDate: dateSchema,
      observations: z.number().int().min(1).max(2000), providerStartDate: dateSchema.optional(), providerEndDate: dateSchema.optional(),
    }).strict()).min(1).max(MAX_REVIEW_ASSETS),
  }).strict().superRefine((value, ctx) => {
    if (value.requestedStart > value.requestedEnd) ctx.addIssue({ code: 'custom', message: 'Acquisition dates must be ordered.' });
    if (new Set(value.assets.map(asset => asset.symbol)).size !== value.assets.length) ctx.addIssue({ code: 'custom', message: 'Acquisition symbols must be unique.' });
    for (const asset of value.assets) {
      if (asset.firstDate > asset.lastDate || asset.firstDate < value.requestedStart || asset.lastDate !== value.requestedEnd ||
          (asset.providerStartDate && asset.providerStartDate > asset.firstDate) || (asset.providerEndDate && asset.providerEndDate < asset.lastDate)) ctx.addIssue({ code: 'custom', message: 'Acquisition coverage is inconsistent with the requested dates.' });
    }
  }).optional(),
}).strict();

export function validateManifest(manifest: DatasetManifest): DatasetManifest {
  const result = datasetManifestSchema.safeParse(manifest);
  if (!result.success) throw new DataValidationError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
  if (result.data.asOf > currentUsDate()) throw new DataValidationError('Dataset cutoff cannot be in the future in America/New_York.');
  return result.data;
}

export function normalizeSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (['USD CASH', 'CASH', 'USD_CASH'].includes(symbol)) return 'CASH';
  if (!/^[A-Z0-9][A-Z0-9._-]{0,24}$/.test(symbol)) throw new DataValidationError('Symbols must contain 1–25 letters, numbers, dots, underscores, or hyphens and start with a letter or number.');
  return symbol;
}

export function finiteNumber(raw: string, context: string): number {
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) {
    throw new DataValidationError(`${context}: enter a finite nonnegative number without currency symbols, thousands separators, or formulas.`);
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) throw new DataValidationError(`${context}: value must be finite.`);
  return value;
}

/** No data rights are inferred from ownership of a file or the presence of an API key. */
export function unknownRights(): DataRights {
  return { display: false, rawPersistence: false, derivedPersistence: false, export: false, publicDisplay: false, evidence: '', verifiedAt: '' };
}
