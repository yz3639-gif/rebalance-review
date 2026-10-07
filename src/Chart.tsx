import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

/** Theme only: the series, dates and currency formatters stay in the shared report model. */
function screenOption(option: EChartsCoreOption): EChartsCoreOption {
  // The shared history chart has one category axis and one value axis. Keep the
  // option local so PDF generation continues to use its original paper theme.
  const xAxis = option.xAxis as Record<string, unknown>;
  const yAxis = option.yAxis as Record<string, unknown>;
  return {
    ...option,
    color: ['#64dfbe', '#78a9ff'],
    backgroundColor: 'transparent',
    textStyle: { color: '#9baaba', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 },
    tooltip: {
      ...(option.tooltip as object),
      backgroundColor: '#16212c', borderColor: '#405468', borderWidth: 1,
      textStyle: { color: '#e7edf3', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: '#637e94', type: 'dashed' } },
      extraCssText: 'box-shadow:0 8px 24px #0005;border-radius:6px;',
    },
    legend: { ...(option.legend as object), textStyle: { color: '#b6c4d1', fontSize: 11 }, itemWidth: 20, itemHeight: 3, itemGap: 24 },
    grid: { left: 64, right: 18, top: 22, bottom: 65 },
    xAxis: {
      ...xAxis,
      axisLabel: { ...(xAxis.axisLabel as object), color: '#9baaba', margin: 14, hideOverlap: true },
      axisLine: { lineStyle: { color: '#344555' } },
    },
    yAxis: {
      ...yAxis,
      axisLabel: { ...(yAxis.axisLabel as object), color: '#9baaba', margin: 12 },
      splitLine: { lineStyle: { color: '#243240', type: 'dashed' } },
    },
  };
}
export default function Chart({ option, label }: { option: EChartsCoreOption; label: string }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!node.current) return;
    const chart = echarts.init(node.current, undefined, { renderer: 'svg' });
    const printMedia = window.matchMedia('print');
    const render = (paper: boolean) => {
      chart.setOption({ animation: false, aria: { enabled: true, decal: { show: true } }, ...(paper ? option : screenOption(option)) }, true);
      chart.resize();
    };
    const beforePrint = () => render(true);
    const afterPrint = () => render(false);
    const onPrintMedia = (event: MediaQueryListEvent) => render(event.matches);
    render(printMedia.matches);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    printMedia.addEventListener('change', onPrintMedia);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      printMedia.removeEventListener('change', onPrintMedia);
      chart.dispose();
    };
  }, [option]);
  return <div ref={node} className="chart" role="img" aria-label={label}/>;
}
