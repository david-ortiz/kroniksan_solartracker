import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, HeatmapChart, SankeyChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  AxisPointerComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { Palette } from '../lib/theme';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CalendarComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  AxisPointerComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

interface Props {
  option: EChartsCoreOption;
  height?: number | string;
  group?: string;
  className?: string;
  onClick?: (params: { name?: string; data?: unknown; dataIndex?: number }) => void;
  ariaLabel?: string;
}

export function EChart({ option, height = 300, group, className, onClick, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => clickRef.current?.(p as never));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  useEffect(() => {
    if (!chart.current || !group) return;
    chart.current.group = group;
    echarts.connect(group);
  }, [group]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={className} style={{ height, width: '100%' }} />;
}

const FONT = 'Geist Variable, system-ui, sans-serif';

/** Shared tooltip look: frosted card, text tokens, never series-colored text. */
export function tooltipBase(p: Palette) {
  return {
    backgroundColor: p.dark ? 'rgba(20,21,25,0.82)' : 'rgba(255,255,255,0.86)',
    borderColor: p.border,
    borderWidth: 1,
    padding: [12, 14],
    textStyle: { color: p.text, fontFamily: FONT, fontSize: 12 },
    extraCssText: 'border-radius:16px;backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px);box-shadow:0 20px 50px -20px rgba(0,0,0,.55);',
  };
}

export function axisBase(p: Palette) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: 11, fontFamily: FONT },
    splitLine: { lineStyle: { color: p.grid, type: [3, 4] } },
  };
}

/** One tooltip row: colored swatch for identity, value in text ink. */
export function row(color: string, label: string, value: string) {
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:5px;min-width:180px">
    <span style="width:8px;height:8px;border-radius:3px;background:${color}"></span>
    <span style="opacity:.72;flex:1">${label}</span>
    <b style="font-variant-numeric:tabular-nums;margin-left:14px;font-weight:600">${value}</b></div>`;
}

export function tipTitle(text: string) {
  return `<div style="font-weight:600;font-size:12.5px;margin-bottom:2px">${text}</div>`;
}
