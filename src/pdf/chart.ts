import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ReviewResult } from '../types';
import { historyChartOption } from './model';

echarts.use([LineChart, GridComponent, LegendComponent, CanvasRenderer]);

/** A fresh chart from the frozen snapshot, never a screenshot of mutable page content. */
export async function createPdfChart(history: ReviewResult['history']): Promise<string> {
  if (history.a.nav.length < 2 || history.a.nav.length !== history.b.nav.length) throw new Error('The report chart has incomplete series.');
  const node = document.createElement('div');
  const chart = echarts.init(node, undefined, { renderer: 'canvas', width: 700, height: 260, devicePixelRatio: 1 });
  try {
    chart.setOption({ ...historyChartOption(history), tooltip: undefined, textStyle: { fontFamily: 'sans-serif' } });
    const data = chart.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#ffffff' });
    if (!data.startsWith('data:image/png;base64,') || data.length < 200) throw new Error('The chart image could not be generated.');
    const image = new Image();
    image.src = data;
    await image.decode();
    if (image.naturalWidth !== 2100 || image.naturalHeight !== 780) throw new Error('The chart image has unexpected dimensions.');
    return data;
  } finally { chart.dispose(); }
}
