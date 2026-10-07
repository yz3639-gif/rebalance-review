import type { ReviewContext, ReviewResult } from '../types';

export type DesignView = 'overview' | 'holdings' | 'risk' | 'scenarios' | 'report';
export type FixtureId = 'standard' | 'fifty' | 'partial' | 'cash' | 'short' | 'restricted' | 'failure';
export interface DesignSnapshot { context: ReviewContext; result: ReviewResult }
export interface DesignViewState {
  view: DesignView;
  range: [number, number];
  unit: 'usd' | 'index';
  riskWindow: 126 | 252 | 504;
  selectedDate: number | null;
  selectedAsset: string | null;
  selectedPair: [string, string] | null;
  costBps: number;
  showDelay: boolean;
}
export const DEFAULT_VIEW_STATE: DesignViewState = {
  view: 'overview', range: [0, 100], unit: 'usd', riskWindow: 252,
  selectedDate: null, selectedAsset: null, selectedPair: null, costBps: 5, showDelay: false,
};
export const FIXTURES: { id: FixtureId; label: string }[] = [
  { id: 'standard', label: 'Core allocation' }, { id: 'fifty', label: '50-asset research basket' },
  { id: 'partial', label: 'Partial coverage' }, { id: 'cash', label: 'All cash' },
  { id: 'short', label: 'Short history' }, { id: 'restricted', label: 'Restricted export' },
  { id: 'failure', label: 'Loading failure' },
];
