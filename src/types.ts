export type Frequency = 'monthly' | 'quarterly' | 'buy-hold';
export interface Holding { symbol: string; weight: number }
export interface PortfolioSpec { id: string; name: string; holdings: Holding[]; marketValues?: Record<string, number> }
export interface DataRights {
  display: boolean;
  rawPersistence: boolean;
  derivedPersistence: boolean;
  export: boolean;
  publicDisplay: boolean;
  evidence: string;
  verifiedAt: string;
}
export interface DatasetManifest {
  id: string;
  source: string;
  currency: 'USD';
  basis: 'adjusted_close' | 'total_return_index' | 'cash_zero';
  asOf: string;
  synthetic: boolean;
  rights: DataRights;
  /** Operation-only prices must be released after a calculation, including failed/cancelled runs. */
  retention?: 'operation' | 'session' | 'persistable';
  policy?: 'tiingo-byok' | 'yahoo-local' | 'user-declared' | 'cash-model';
  acquisition?: {
    requestedStart: string;
    requestedEnd: string;
    assets: { symbol: string; firstDate: string; lastDate: string; observations: number; providerStartDate?: string; providerEndDate?: string }[];
  };
}
export interface CatalogSnapshot {
  version: string;
  asOf: string;
  assets: { symbol: string; name: string; exchange?: string; sourceUrl: string; identity: 'verified' | 'pending' }[];
}
export interface MarketDataset {
  manifest: DatasetManifest;
  dates: string[];
  symbols: string[];
  /** Rows are dates; columns are symbols. Finite strictly positive prices. */
  prices: number[][];
}
export interface ReviewSpec {
  a: PortfolioSpec;
  b: PortfolioSpec;
  dataset: MarketDataset;
  frequency: Frequency;
  costBps: number;
  initialNav: number;
  cashReturnConfirmed: boolean;
  partialCoverageConfirmed: boolean;
}
/** Rendering and journal input deliberately exclude raw market observations and API credentials. */
export type ReviewContext = Omit<ReviewSpec, 'dataset'> & { manifest: DatasetManifest; catalog?: CatalogSnapshot };
export interface RiskSummary {
  volatility: number;
  contributions: Record<string, number>;
  relativeContributions: Record<string, number> | null;
}
export interface RiskWindow {
  window: number;
  available: boolean;
  observations: number;
  a?: RiskSummary;
  b?: RiskSummary;
  covariance?: number[][];
}
export interface BacktestResult {
  dates: string[];
  nav: number[];
  drawdowns: number[];
  totalReturn: number;
  cagr: number;
  volatility: number;
  maxDrawdown: number;
  fees: number;
  turnover: number;
  trades: number;
}
export interface ReviewResult {
  id: string;
  asOf: string;
  start: string;
  end: string;
  observations: number;
  symbols: string[];
  partial: boolean;
  coverage: { a: number; b: number };
  risk: { windows: RiskWindow[] };
  history: { a: BacktestResult; b: BacktestResult };
  costSensitivity: { costBps: number; aCagr: number; bCagr: number }[];
  delaySensitivity: { a: BacktestResult; b: BacktestResult };
  warnings: string[];
}
export interface ReviewRecord {
  schemaVersion: 1 | 2;
  id: string;
  createdAt: string;
  rationale: string;
  nextReview: string;
  a: PortfolioSpec;
  b: PortfolioSpec;
  manifest: DatasetManifest;
  settings: Pick<ReviewSpec, 'frequency' | 'costBps' | 'initialNav' | 'cashReturnConfirmed' | 'partialCoverageConfirmed'>;
  result: ReviewResult;
  dataset?: MarketDataset;
  catalog?: CatalogSnapshot;
  versions?: { app: string; engine: string; method: string };
}
export interface ProviderProgress { completed: number; total: number; symbol?: string; status: 'loading' | 'complete' }
export interface ProviderAdapter {
  id: string;
  label: string;
  fetch(request: ProviderRequest, signal: AbortSignal, onProgress?: (progress: ProviderProgress) => void): Promise<MarketDataset>;
}
export interface ProviderRequest { symbols: string[]; start: string; end: string }
