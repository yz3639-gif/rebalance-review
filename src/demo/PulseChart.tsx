import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsType, EChartsCoreOption } from "echarts/core";
import type { ReplayQuote } from "./replayFeed";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  SVGRenderer,
]);
export function Sparkline({
  values,
  positive,
  className = "",
}: {
  values: number[];
  positive: boolean;
  className?: string;
}) {
  const min = Math.min(...values),
    spread = Math.max(...values) - min || 1;
  const path = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * 100).toFixed(2)},${(30 - ((v - min) / spread) * 26).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg
      className={`mp-spark ${className}`}
      viewBox="0 0 100 34"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={positive ? "#65d6b5" : "#f1939b"}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function PulseChart({
  quote,
  range,
  area,
  onInspect,
}: {
  quote: ReplayQuote;
  range: "30m" | "1h" | "all";
  area: boolean;
  onInspect: (index: number | null) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    chart = useRef<EChartsType | null>(null);
  const callback = useRef(onInspect);
  callback.current = onInspect;
  const visible = useMemo(
    () =>
      range === "all"
        ? quote.history
        : quote.history.slice(range === "30m" ? -61 : -121),
    [quote.history, range],
  );
  const offset = quote.history.length - visible.length;
  const clickOffset = useRef(offset);
  clickOffset.current = offset;
  useEffect(() => {
    if (!node.current) return;
    const instance = echarts.init(node.current, undefined, { renderer: "svg" });
    chart.current = instance;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!instance.isDisposed()) instance.resize();
      });
    });
    observer.observe(node.current);
    instance.on("click", (event: unknown) => {
      const i = (event as { dataIndex?: number }).dataIndex;
      if (typeof i === "number") callback.current(i + clickOffset.current);
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);
  const option = useMemo<EChartsCoreOption>(() => {
    const positive = quote.changePct >= 0,
      color = positive ? "#68dbbb" : "#f19b9f";
    const labels = visible.map((p) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(p.timestamp)),
    );
    return {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: "Geist Mono Variable, monospace", fontSize: 10 },
      grid: [
        { left: 14, right: 65, top: 20, bottom: 100 },
        { left: 14, right: 65, height: 48, bottom: 25 },
      ],
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "#17212c",
        borderColor: "#34434e",
        textStyle: {
          color: "#edf5f5",
          fontFamily: "Geist Mono Variable, monospace",
          fontSize: 11,
        },
        axisPointer: { type: "cross", label: { backgroundColor: "#35474f" } },
        valueFormatter: (v: unknown) =>
          typeof v === "number"
            ? v.toLocaleString("en-US", { maximumFractionDigits: 2 })
            : String(v),
      },
      xAxis: [0, 1].map((i) => ({
        type: "category",
        gridIndex: i,
        data: labels,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisPointer: { show: i === 0 },
        axisLabel: {
          show: i === 1,
          color: "#9daeb8",
          fontSize: 10,
          hideOverlap: true,
          interval: Math.max(1, Math.floor(labels.length / 5)),
        },
      })),
      yAxis: [
        {
          type: "value",
          position: "right",
          scale: true,
          min: (v: { min: number; max: number }) =>
            Math.min(v.min, quote.previousClose) -
            Math.max((v.max - v.min) * 0.2, quote.price * 0.001),
          max: (v: { min: number; max: number }) =>
            Math.max(v.max, quote.previousClose) +
            Math.max((v.max - v.min) * 0.2, quote.price * 0.001),
          axisLabel: {
            color: "#9daeb8",
            formatter: (v: number) => v.toFixed(2),
            fontSize: 10,
          },
          splitNumber: 5,
          splitLine: {
            lineStyle: { color: "#24303a", type: "dashed", opacity: 0.6 },
          },
        },
        { type: "value", gridIndex: 1, show: false },
      ],
      series: [
        {
          id: "price",
          name: `${quote.symbol} · synthetic USD`,
          type: "line",
          data: visible.map((p) => p.price),
          showSymbol: false,
          symbolSize: 6,
          sampling: "lttb",
          lineStyle: { width: 2, color },
          itemStyle: { color },
          areaStyle: area
            ? {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: positive ? "#65d6b52b" : "#f1939b2b" },
                  { offset: 1, color: "#11182000" },
                ]),
              }
            : { opacity: 0 },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: {
              color: "#829098",
              type: "dashed",
              width: 1,
              opacity: 0.6,
            },
            label: { show: false },
            data: [{ yAxis: quote.previousClose }],
          },
        },
        {
          id: "volume",
          name: "Synthetic interval volume",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: visible.map((p, i) => ({
            value: p.volume,
            itemStyle: {
              color:
                i && p.price < visible[i - 1].price ? "#ac666a60" : "#65d6b54d",
            },
          })),
          barWidth: "65%",
        },
      ],
    };
  }, [quote, visible, area]);
  useEffect(() => {
    chart.current?.setOption(option, { lazyUpdate: false, silent: true });
  }, [option]);
  return (
    <div
      ref={node}
      className="mp-price-chart"
      data-testid="pulse-chart"
      role="img"
      aria-label={`${quote.symbol} synthetic intraday price and volume. Exact values are available in the session data table.`}
    />
  );
}
