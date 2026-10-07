import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart } from 'echarts/charts';
import { AriaComponent, AxisPointerComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, EChartsType } from 'echarts/core';
import { costRows, correlation, indexedNav, riskRows } from './model';
import type { DesignSnapshot, DesignViewState } from './types';

echarts.use([BarChart, HeatmapChart, LineChart, AriaComponent, AxisPointerComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

const colors = { a: '#7AA2FF', b: '#53D3C3', text: '#99a4b3', border: '#253040', amber: '#eab676', foreground: '#e2e8f0', empty: '#17212e' };
const mono = '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
interface ChartEvent {
  dataIndex?: number; componentType?: string; seriesIndex?: number; name?: string; value?: unknown; data?: unknown;
  offsetX?: number; offsetY?: number;
  start?: number; end?: number; batch?: { start?: number; end?: number }[];
  axesInfo?: { value?: string | number }[];
  areas?: { coordRange?: number[] }[];
}
type ChartEvents = Record<string, (event: ChartEvent, chart: EChartsType) => void>;
interface TooltipDatum { name?: string; seriesName?: string; value?: unknown; data?: unknown; color?: string }
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const percent = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signed = (value: number, digits = 2) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`;
function tooltipList(params: unknown): TooltipDatum[] { return (Array.isArray(params) ? params : [params]).filter((item): item is TooltipDatum => !!item && typeof item === 'object'); }
function datum(value: unknown): { value?: unknown; symbol?: string; a?: number; b?: number; delta?: number; covered?: boolean; x?: string; y?: string; unavailable?: boolean } {
  return value && typeof value === 'object' ? value : {};
}
const theme: EChartsCoreOption = {
  animation: false, backgroundColor: 'transparent', color: [colors.a, colors.b],
  textStyle: { color: colors.text, fontFamily: mono, fontSize: 11 },
  aria: { enabled: true, decal: { show: false } },
  tooltip: { confine: true, backgroundColor: '#111a27', borderColor: colors.border, borderWidth: 1, textStyle: { color: colors.foreground, fontFamily: mono, fontSize: 11 }, padding: [10, 12], extraCssText: 'border-radius:7px;box-shadow:0 8px 28px #0004;line-height:1.9;' },
};
const categoryStyle = { axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false }, axisLabel: { color: colors.text, fontSize: 10, hideOverlap: true } };
const valueStyle = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: colors.text, fontSize: 10 }, splitLine: { lineStyle: { color: colors.border, type: 'dashed' } } };

/** Keep one SVG chart instance for its mounted lifetime; callbacks never become stale. */
function useChart(option: EChartsCoreOption, events: ChartEvents = {}) {
  const node = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const callbacks = useRef(events); callbacks.current = events;
  const eventNames = Object.keys(events).sort().join('|');
  useEffect(() => {
    if (!node.current) return;
    const chart = echarts.init(node.current, undefined, { renderer: 'svg' });
    instance.current = chart;
    let frame = 0;
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!chart.isDisposed()) chart.resize(); }); };
    const observer = new ResizeObserver(resize); observer.observe(node.current);
    const registered = eventNames ? eventNames.split('|') : [];
    for (const name of registered) {
      const callback = (event: unknown) => callbacks.current[name]?.((event ?? {}) as ChartEvent, chart);
      if (name.startsWith('zr:')) chart.getZr().on(name.slice(3), callback); else chart.on(name, callback);
    }
    return () => { cancelAnimationFrame(frame); observer.disconnect(); for (const name of registered) { if (name.startsWith('zr:')) chart.getZr().off(name.slice(3)); else chart.off(name); } chart.dispose(); instance.current = null; };
  }, [eventNames]);
  useEffect(() => { instance.current?.setOption(option, { notMerge: true, lazyUpdate: false, silent: true }); }, [option]);
  return node;
}
function blankOption(message: string, detail: string): EChartsCoreOption {
  return { ...theme, graphic: [
    { type: 'text', left: 'center', top: '41%', style: { text: message, fill: colors.foreground, font: `14px ${mono}`, textAlign: 'center' } },
    { type: 'text', left: 'center', top: '51%', style: { text: detail, fill: colors.text, font: `10px ${mono}`, textAlign: 'center', lineHeight: 18 } },
  ] };
}
function categorySelection(event: ChartEvent): string | null {
  const item = datum(event.data);
  if (typeof item.symbol === 'string') return item.symbol;
  return event.componentType === 'yAxis' && typeof event.value === 'string' ? event.value : null;
}
function axisMoney(value: number) {
  const absolute = Math.abs(value);
  return absolute >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}m` : absolute >= 1_000 ? `$${(value / 1_000).toFixed(1)}k` : `$${value.toFixed(0)}`;
}

export function HistoryChart({ snapshot, state, onRange, onHover, onSelectDate }: {
  snapshot: DesignSnapshot; state: DesignViewState; onRange: (range: [number, number]) => void;
  onHover: (index: number | null) => void; onSelectDate: (index: number) => void;
}) {
  const { result, context } = snapshot;
  const dates = result.history.a.dates;
  const dateIndex = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < dates.length ? value : typeof value === 'string' ? dates.indexOf(value) : -1;
  const option = useMemo<EChartsCoreOption>(() => {
    const path = (nav: number[]) => state.unit === 'index' ? indexedNav(nav, context.initialNav) : nav;
    const selected = state.selectedDate !== null ? dates[state.selectedDate] : undefined;
    const line = (name: string, values: number[], color: string, xAxisIndex = 0, dashed = false) => ({
      name, type: 'line', xAxisIndex, yAxisIndex: xAxisIndex, data: values, showSymbol: false, symbolSize: 5,
      smooth: false, sampling: 'lttb', lineStyle: { color, width: dashed ? 1.5 : 2, type: dashed ? 'dashed' : 'solid', opacity: dashed ? .65 : 1 },
      itemStyle: { color }, emphasis: { focus: 'series' },
      ...(xAxisIndex === 1 ? { areaStyle: { color, opacity: .06 } } : {}),
      ...(selected && !dashed ? { markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#90a2b9', type: 'dashed', width: 1 }, data: [{ xAxis: selected }] } } : {}),
    });
    const series = [line('A · Current', path(result.history.a.nav), colors.a), line('B · Proposed', path(result.history.b.nav), colors.b), line('A · Drawdown', result.history.a.drawdowns, colors.a, 1), line('B · Drawdown', result.history.b.drawdowns, colors.b, 1)];
    if (state.showDelay) series.push(line('A · +1 session delay', path(result.delaySensitivity.a.nav), colors.a, 0, true), line('B · +1 session delay', path(result.delaySensitivity.b.nav), colors.b, 0, true));
    return {
      ...theme,
      aria: { enabled: true, label: { description: `Hypothetical portfolio wealth and full-history drawdown on synchronized date axes. ${state.unit === 'index' ? 'Index 100 is initial capital before fees.' : 'Values are in US dollars.'} ${state.showDelay ? 'Dashed paths use the recorded extra-session execution delay.' : ''}` } },
      grid: [{ left: 65, right: 18, top: 18, height: '45%' }, { left: 65, right: 18, top: '62%', height: '19%' }],
      xAxis: [0, 1].map(index => ({ ...categoryStyle, type: 'category', gridIndex: index, data: dates, boundaryGap: false, axisLabel: { show: index === 1, color: colors.text, fontSize: 10, hideOverlap: true, formatter: (value: string) => value.slice(0, 7) }, axisPointer: { label: { show: index === 1, backgroundColor: '#344257' } } })),
      yAxis: [{ ...valueStyle, type: 'value', scale: true, axisLabel: { color: colors.text, fontSize: 10, formatter: (value: number) => state.unit === 'usd' ? axisMoney(value) : value.toFixed(0) } }, { ...valueStyle, type: 'value', gridIndex: 1, max: 0, min: (extent: { min: number }) => Math.min(-.005, extent.min), name: 'DRAWDOWN', nameTextStyle: { color: colors.text, fontSize: 9 }, nameGap: 9, splitNumber: 2, axisLabel: { color: colors.text, fontSize: 9, formatter: (value: number) => percent(value, 0) } }],
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#8091a6', type: 'dashed' } },
      tooltip: { ...(theme.tooltip as object), trigger: 'axis', axisPointer: { type: 'line' }, formatter: (params: unknown) => {
        const first = tooltipList(params)[0], index = dates.indexOf(String(first?.name));
        if (index < 0) return '';
        const wealth = (value: number) => state.unit === 'usd' ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : (value / context.initialNav * 100).toFixed(2);
        const delta = result.history.b.nav[index] - result.history.a.nav[index];
        const difference = state.unit === 'usd' ? `${delta < 0 ? '−' : delta > 0 ? '+' : ''}${wealth(Math.abs(delta))}` : `${signed(delta / context.initialNav * 100)} index pts`;
        return `${escape(dates[index])}<br/>A · Wealth <strong>${wealth(result.history.a.nav[index])}</strong><br/>B · Wealth <strong>${wealth(result.history.b.nav[index])}</strong><br/>B − A · Wealth <strong>${difference}</strong><br/>A · Drawdown <strong>${percent(result.history.a.drawdowns[index])}</strong><br/>B · Drawdown <strong>${percent(result.history.b.drawdowns[index])}</strong>${state.showDelay ? `<br/>A · +1 session <strong>${wealth(result.delaySensitivity.a.nav[index])}</strong><br/>B · +1 session <strong>${wealth(result.delaySensitivity.b.nav[index])}</strong>` : ''}`;
      } },
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: state.range[0], end: state.range[1], filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: true, preventDefaultMouseMove: false }, { type: 'slider', xAxisIndex: [0, 1], start: state.range[0], end: state.range[1], filterMode: 'none', bottom: 7, height: 22, brushSelect: true, borderColor: colors.border, backgroundColor: '#0b1320', fillerColor: '#7aa2ff16', dataBackground: { lineStyle: { color: '#4a617e' }, areaStyle: { color: '#24364f' } }, selectedDataBackground: { lineStyle: { color: colors.a }, areaStyle: { color: '#385e92' } }, handleStyle: { color: '#637893', borderColor: '#8da5c5' }, textStyle: { color: colors.text, fontSize: 9 }, showDetail: false }],
      series,
    };
  }, [result, context.initialNav, dates, state.unit, state.showDelay, state.range[0], state.range[1], state.selectedDate]);
  const ref = useChart(option, {
    datazoom: event => { const range = event.batch?.[0] ?? event; if (Number.isFinite(range.start) && Number.isFinite(range.end)) onRange([Math.max(0, range.start!), Math.min(100, range.end!)]); },
    updateAxisPointer: event => { const index = dateIndex(event.axesInfo?.[0]?.value); if (index >= 0) onHover(index); },
    globalout: () => onHover(null),
    'zr:click': (event, chart) => {
      if (typeof event.offsetX !== 'number' || typeof event.offsetY !== 'number') return;
      const point = [event.offsetX, event.offsetY];
      if (!chart.containPixel({ gridIndex: 0 }, point) && !chart.containPixel({ gridIndex: 1 }, point)) return;
      const value = chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX);
      const index = typeof value === 'number' ? Math.max(0, Math.min(dates.length - 1, Math.round(value))) : dateIndex(value);
      if (index >= 0) onSelectDate(index);
    },
  });
  return <div ref={ref} className="dr-chart dr-history-chart" data-testid="history-chart" data-range-start={state.range[0]} data-range-end={state.range[1]} data-unit={state.unit} data-selected-date={state.selectedDate ?? ''} role="img" aria-label="Historical wealth and drawdown. Drag the date slider to choose a range; click a path to inspect a date. Drawdowns retain their full-history peaks." style={{ height: 390, width: '100%', minWidth: 0 }} />;
}

export function WeightChart({ rows, selected, onSelect }: { rows: { symbol: string; a: number; b: number; delta: number; covered: boolean }[]; selected: string | null; onSelect: (symbol: string) => void }) {
  const viewportStart = Math.max(0, Math.min(rows.length - 12, rows.findIndex(row => row.symbol === selected) - 5));
  const option = useMemo<EChartsCoreOption>(() => ({
    ...theme, grid: { left: 73, right: 43, top: 28, bottom: rows.length > 12 ? 31 : 23 },
    aria: { enabled: true, label: { description: 'Signed allocation change, portfolio B minus A, in percentage points. Assets outside historical coverage remain visible.' } },
    xAxis: { ...valueStyle, type: 'value', name: 'B − A · percentage points', nameLocation: 'middle', nameGap: 27, nameTextStyle: { color: colors.text, fontSize: 10 }, axisLabel: { color: colors.text, fontSize: 10, formatter: (value: number) => signed(value, 0) } },
    yAxis: { ...categoryStyle, type: 'category', inverse: true, data: rows.map(row => row.symbol), triggerEvent: true, axisLabel: { color: (value: string) => value === selected ? colors.foreground : colors.text, fontSize: 10, interval: 0, width: 62, overflow: 'truncate' } },
    ...(rows.length > 12 ? { dataZoom: [{ type: 'slider', yAxisIndex: 0, right: 0, top: 28, bottom: 32, width: 9, start: 100 * viewportStart / rows.length, end: 100 * (viewportStart + 12) / rows.length, showDetail: false, showDataShadow: false, borderColor: colors.border, fillerColor: '#7aa2ff22', handleStyle: { color: '#60738c' } }, { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true, moveOnMouseMove: true }] } : {}),
    tooltip: { ...(theme.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: unknown) => {
      const row = datum(tooltipList(params)[0]?.data);
      return `${escape(row.symbol)}${row.covered === false ? ' · Outside coverage' : ''}<br/>A · ${percent(row.a ?? 0)}<br/>B · ${percent(row.b ?? 0)}<br/>B − A · <strong>${signed((row.delta ?? 0) * 100)} pp</strong>`;
    } },
    series: [{ type: 'bar', name: 'Allocation change', barMaxWidth: 18, data: rows.map(row => ({ ...row, value: row.delta * 100, itemStyle: { color: row.covered ? row.delta >= 0 ? colors.b : colors.a : '#68798d', opacity: selected && selected !== row.symbol ? .65 : 1, borderColor: selected === row.symbol ? '#e2e8f0' : 'transparent', borderWidth: selected === row.symbol ? 1 : 0, borderRadius: 2 } })), label: { show: rows.length <= 12, position: 'right', color: colors.foreground, fontSize: 10, formatter: (params: unknown) => { const value = tooltipList(params)[0]?.value; return typeof value === 'number' ? signed(value, 1) : ''; } }, emphasis: { itemStyle: { opacity: 1 } }, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#687990', width: 1 }, data: [{ xAxis: 0 }] } }],
  }), [rows, selected, viewportStart]);
  const ref = useChart(option, { click: event => { const symbol = categorySelection(event); if (symbol) onSelect(symbol); } });
  return <div ref={ref} className="dr-chart dr-weight-chart" data-testid="weight-chart" data-selected-asset={selected ?? ''} role="img" aria-label="Signed weight change by asset, B minus A in percentage points. Click a bar or symbol to select an asset." style={{ height: Math.min(480, Math.max(200, rows.length * 31 + 68)), width: '100%', minWidth: 0 }} />;
}

export function RiskChart({ snapshot, state, onSelect }: { snapshot: DesignSnapshot; state: DesignViewState; onSelect: (symbol: string) => void }) {
  const risk = snapshot.result.risk.windows.find(item => item.window === state.riskWindow);
  const rows = useMemo(() => riskRows(snapshot, state.riskWindow).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta)), [snapshot, state.riskWindow]);
  const viewportStart = Math.max(0, Math.min(rows.length - 12, rows.findIndex(row => row.symbol === state.selectedAsset) - 5));
  const option = useMemo<EChartsCoreOption>(() => {
    if (!risk?.available || !risk.a || !risk.b) return blankOption('Risk window unavailable', `Needs ${state.riskWindow} complete daily returns.\nRecorded window: ${risk?.observations ?? 0} returns.`);
    return {
      ...theme, grid: { left: 73, right: 45, top: 26, bottom: 43 },
      aria: { enabled: true, label: { description: `Change in signed Euler contributions to annualized volatility, B minus A, estimated over ${state.riskWindow} returns. Negative contributions and changes are preserved.` } },
      xAxis: { ...valueStyle, type: 'value', name: 'Δ volatility contribution · pp', nameLocation: 'middle', nameGap: 29, nameTextStyle: { color: colors.text, fontSize: 10 }, axisLabel: { color: colors.text, fontSize: 10, formatter: (value: number) => signed(value, 1) } },
      yAxis: { ...categoryStyle, type: 'category', inverse: true, data: rows.map(row => row.symbol), triggerEvent: true, axisLabel: { color: (value: string) => value === state.selectedAsset ? colors.foreground : colors.text, fontSize: 10, interval: 0, width: 62, overflow: 'truncate' } },
      ...(rows.length > 12 ? { dataZoom: [{ type: 'slider', yAxisIndex: 0, start: 100 * viewportStart / rows.length, end: 100 * (viewportStart + 12) / rows.length, right: 0, top: 26, bottom: 43, width: 9, showDetail: false, showDataShadow: false, borderColor: colors.border, fillerColor: '#7aa2ff22', handleStyle: { color: '#60738c' } }, { type: 'inside', yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true }] } : {}),
      tooltip: { ...(theme.tooltip as object), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: unknown) => {
        const row = datum(tooltipList(params)[0]?.data);
        return `${escape(row.symbol)} · ${state.riskWindow} returns<br/>A contribution · ${signed((row.a ?? 0) * 100)} pp<br/>B contribution · ${signed((row.b ?? 0) * 100)} pp<br/>B − A · <strong>${signed((row.delta ?? 0) * 100)} pp</strong>${row.symbol === 'CASH' ? `<br/>Modeled cash contribution: 0.<br/>Relative risk: A ${risk.a!.volatility === 0 ? 'N/A' : '0%'} · B ${risk.b!.volatility === 0 ? 'N/A' : '0%'}.` : ''}`;
      } },
      series: [{ type: 'bar', barMaxWidth: 20, data: rows.map(row => ({ ...row, value: row.delta * 100, itemStyle: { color: row.delta > 0 ? colors.amber : colors.b, opacity: state.selectedAsset && state.selectedAsset !== row.symbol ? .65 : 1, borderColor: state.selectedAsset === row.symbol ? '#e2e8f0' : 'transparent', borderWidth: state.selectedAsset === row.symbol ? 1 : 0, borderRadius: 2 } })), label: { show: rows.length <= 12, position: 'right', color: colors.foreground, fontSize: 10, formatter: (params: unknown) => { const value = tooltipList(params)[0]?.value; return typeof value === 'number' ? signed(value, 2) : ''; } }, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#687990', width: 1 }, data: [{ xAxis: 0 }] } }],
    };
  }, [risk, rows, state.riskWindow, state.selectedAsset, viewportStart]);
  const ref = useChart(option, { click: event => { const symbol = categorySelection(event); if (symbol) onSelect(symbol); } });
  return <div ref={ref} className="dr-chart dr-risk-chart" data-testid="risk-chart" data-risk-window={state.riskWindow} data-selected-asset={state.selectedAsset ?? ''} role="img" aria-label={`Change in signed volatility contributions over ${state.riskWindow} daily returns. Negative values are preserved. Click a bar or symbol to inspect it.`} style={{ height: 400, width: '100%', minWidth: 0 }} />;
}

export function CorrelationChart({ snapshot, state, onPair }: { snapshot: DesignSnapshot; state: DesignViewState; onPair: (pair: [string, string]) => void }) {
  const matrix = useMemo(() => correlation(snapshot.result.risk.windows.find(item => item.window === state.riskWindow), snapshot.result.symbols), [snapshot, state.riskWindow]);
  const option = useMemo<EChartsCoreOption>(() => {
    if (!matrix) return blankOption('Correlation unavailable', 'The selected window has no valid covariance matrix.');
    const symbols = matrix.symbols;
    const cells: object[] = [], unavailable: object[] = [];
    matrix.values.forEach((row, y) => row.forEach((value, x) => {
      const highlighted = !!state.selectedPair && ((symbols[x] === state.selectedPair[0] && symbols[y] === state.selectedPair[1]) || (symbols[y] === state.selectedPair[0] && symbols[x] === state.selectedPair[1]));
      const assetMatch = !state.selectedAsset || symbols[x] === state.selectedAsset || symbols[y] === state.selectedAsset;
      const point = { value: [x, y, value ?? 0], x: symbols[x], y: symbols[y], unavailable: value === null, label: { color: value !== null && Math.abs(value) >= .65 ? '#07131c' : colors.foreground }, itemStyle: { borderColor: highlighted ? '#ffffff' : assetMatch && state.selectedAsset ? '#96aec8' : '#111a27', borderWidth: highlighted ? 2 : 1, opacity: 1, ...(value === null ? { color: colors.empty } : {}) } };
      (value === null ? unavailable : cells).push(point);
    }));
    const labelInterval = (index: number, symbol: string) => symbols.length <= 12 || index % Math.ceil(symbols.length / 12) === 0 || symbol === state.selectedAsset || !!state.selectedPair?.includes(symbol);
    const label = { color: (symbol: string) => symbol === state.selectedAsset || state.selectedPair?.includes(symbol) ? colors.foreground : colors.text, fontSize: symbols.length > 12 ? 8 : 10, interval: labelInterval };
    return {
      ...theme, grid: { left: symbols.length > 12 ? 49 : 57, right: 15, top: 15, bottom: 78 },
      aria: { enabled: true, label: { description: `Correlations implied by the ${state.riskWindow}-return Ledoit-Wolf covariance in recorded symbol order. Cash and zero-variance pairs are undefined, shown as N/A.` } },
      xAxis: { ...categoryStyle, type: 'category', data: symbols, splitArea: { show: false }, axisLabel: { ...label, rotate: symbols.length > 5 ? 50 : 0 }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { ...categoryStyle, type: 'category', data: symbols, inverse: true, axisLabel: label, axisLine: { show: false }, axisTick: { show: false } },
      visualMap: [{ min: -1, max: 1, seriesIndex: [0], dimension: 2, orient: 'horizontal', left: 'center', bottom: 1, itemWidth: 10, itemHeight: 150, calculable: false, text: ['+1', '−1'], textGap: 8, textStyle: { color: colors.text, fontSize: 9 }, inRange: { color: ['#678ed1', '#202c3d', '#53bbaa'] }, precision: 2 }, { show: false, min: 0, max: 1, seriesIndex: [1], dimension: 2, inRange: { color: [colors.empty, colors.empty] } }],
      tooltip: { ...(theme.tooltip as object), trigger: 'item', formatter: (params: unknown) => { const row = datum(tooltipList(params)[0]?.data); const value = Array.isArray(row.value) ? row.value[2] : null; return `${escape(row.x)} × ${escape(row.y)}<br/>${row.unavailable ? '<strong>N/A</strong> · zero variance / cash' : `Correlation · <strong>${typeof value === 'number' ? value.toFixed(3) : 'N/A'}</strong>`}<br/>${state.riskWindow}-return covariance estimate`; } },
      series: [{ name: 'Correlation', type: 'heatmap', data: cells, progressive: 0, label: { show: symbols.length <= 8, color: '#e2e8f0', fontSize: 10, formatter: (params: unknown) => { const value = tooltipList(params)[0]?.value; return Array.isArray(value) && typeof value[2] === 'number' ? value[2].toFixed(2) : ''; } }, emphasis: { itemStyle: { borderColor: '#ffffff', borderWidth: 2 } } }, { name: 'Undefined correlation', type: 'heatmap', data: unavailable, progressive: 0, label: { show: symbols.length <= 8, color: colors.text, fontSize: 10, formatter: 'N/A' }, emphasis: { itemStyle: { borderColor: '#ffffff', borderWidth: 2 } } }],
    };
  }, [matrix, state.riskWindow, state.selectedAsset, state.selectedPair]);
  const ref = useChart(option, { click: event => { const cell = datum(event.data); if (cell.x && cell.y) onPair([cell.x, cell.y]); } });
  return <div ref={ref} className="dr-chart dr-correlation-chart" data-testid="correlation-chart" data-risk-window={state.riskWindow} data-selected-pair={state.selectedPair?.join('/') ?? ''} role="img" aria-label={`Covariance-implied correlation matrix for ${state.riskWindow} daily returns. Cash pairs are N/A. Click a cell to inspect the pair.`} style={{ height: 480, width: '100%', minWidth: 0 }} />;
}

export function CostChart({ snapshot, state, onSelect }: { snapshot: DesignSnapshot; state: DesignViewState; onSelect: (cost: number) => void }) {
  const rows = useMemo(() => costRows(snapshot), [snapshot]);
  const option = useMemo<EChartsCoreOption>(() => ({
    ...theme, grid: { left: 60, right: 25, top: 39, bottom: 46 },
    aria: { enabled: true, label: { description: 'Recorded annualized returns at the four tested per-side cost assumptions and the applied baseline. Lines connect tested points only; no interpolated scenario is selectable.' } },
    legend: { top: 0, left: 0, data: ['A · Current', 'B · Proposed'], textStyle: { color: colors.text, fontSize: 10 }, itemWidth: 17, itemHeight: 3, selectedMode: false },
    xAxis: { ...categoryStyle, type: 'value', min: 0, max: Math.max(...rows.map(row => row.costBps)) + 1, name: 'Cost per side · bps', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: colors.text, fontSize: 10 }, splitLine: { show: false }, axisLabel: { color: colors.text, fontSize: 10 } },
    yAxis: { ...valueStyle, type: 'value', scale: true, name: 'CAGR', nameTextStyle: { color: colors.text, fontSize: 9 }, axisLabel: { color: colors.text, fontSize: 10, formatter: (value: number) => percent(value, 2) } },
    tooltip: { ...(theme.tooltip as object), trigger: 'item', formatter: (params: unknown) => { const item = tooltipList(params)[0]; const value = item?.value; return Array.isArray(value) ? `${escape(item.seriesName)}<br/>${value[0]} bps per side<br/>CAGR · <strong>${percent(value[1])}</strong>` : ''; } },
    series: [
      { name: 'A · Current', field: 'aCagr' as const, color: colors.a },
      { name: 'B · Proposed', field: 'bCagr' as const, color: colors.b },
    ].map(series => ({ name: series.name, type: 'line', smooth: false, showSymbol: true, symbol: 'circle', lineStyle: { color: series.color, width: 2 }, itemStyle: { color: series.color }, data: rows.map(row => ({ value: [row.costBps, row[series.field]], symbolSize: state.costBps === row.costBps ? 11 : 7, itemStyle: { color: series.color, borderColor: state.costBps === row.costBps ? colors.foreground : '#0d1521', borderWidth: 2 } })), ...(rows.some(row => row.costBps === state.costBps) ? { markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: '#8091a6', type: 'dashed', width: 1 }, data: [{ xAxis: state.costBps }] } } : {}) })),
  }), [rows, state.costBps]);
  const ref = useChart(option, { click: event => { const value = Array.isArray(event.value) ? event.value : datum(event.data).value; if (Array.isArray(value) && typeof value[0] === 'number' && rows.some(row => row.costBps === value[0])) onSelect(value[0]); } });
  return <div ref={ref} className="dr-chart dr-cost-chart" data-testid="cost-chart" data-selected-cost={state.costBps} role="img" aria-label="Annualized return at recorded cost assumptions and the applied baseline. Click a computed point to inspect its cost." style={{ height: 300, width: '100%', minWidth: 0 }} />;
}
