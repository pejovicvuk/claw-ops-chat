"use client";

import { useEffect, useRef } from "react";

export interface MultiSeriesData {
  label: string;
  color: string;
  /** Time-series points; `t` is ms-epoch, `v` is value. Will be clipped to [from, to]. */
  points: Array<{ t: number; v: number }>;
}

interface MultiSeriesChartProps {
  series: MultiSeriesData[];
  /** ms-epoch left edge of the X axis. */
  from: number;
  /** ms-epoch right edge of the X axis. */
  to: number;
  /** Y-axis lower bound; default 0. */
  yMin?: number;
  /** Y-axis upper bound; default `auto` (max of series + 10% pad). */
  yMax?: number | "auto";
  /** Render height in CSS px. Width is responsive. */
  height?: number;
  /** Y-axis tick label suffix (e.g., "%", " MB"). */
  yUnit?: string;
  /** Number of horizontal grid lines. Default 4 (0/25/50/75/100). */
  gridLines?: number;
  /** Right-side aria label fallback. */
  ariaLabel: string;
}

/**
 * Pure HTML5 Canvas multi-line chart with 2× DPR rendering for retina.
 * No charting-library dependency. Repaints on every prop change; cheap
 * because all geometry is pre-computed once per draw and we only handle
 * a handful of series.
 *
 * Theme-aware: reads CSS vars `--mon-chart-grid` / `--mon-chart-axis` /
 * `--canvas-muted` and the user's `.dark` class for foreground colors.
 */
export function MultiSeriesChart({
  series,
  from,
  to,
  yMin = 0,
  yMax = "auto",
  height = 160,
  yUnit = "",
  gridLines = 4,
  ariaLabel,
}: MultiSeriesChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw(canvas, series, from, to, yMin, yMax, height, yUnit, gridLines);
  }, [series, from, to, yMin, yMax, height, yUnit, gridLines]);

  // Repaint on resize so the responsive width stays crisp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() =>
      draw(canvas, series, from, to, yMin, yMax, height, yUnit, gridLines),
    );
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [series, from, to, yMin, yMax, height, yUnit, gridLines]);

  return (
    <div className="rounded-md border border-canvas-border bg-canvas-bg">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-canvas-border px-3 py-1.5">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[10.5px]">
            <span
              aria-hidden="true"
              className="inline-block h-[2px] w-3 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-canvas-muted">{s.label}</span>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-canvas-muted">{ariaLabel}</span>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        className="block w-full"
        style={{ height }}
      />
    </div>
  );
}

function draw(
  canvas: HTMLCanvasElement,
  series: MultiSeriesData[],
  from: number,
  to: number,
  yMinIn: number,
  yMaxIn: number | "auto",
  cssHeight: number,
  yUnit: string,
  gridLineCount: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const cssWidth = canvas.offsetWidth;
  if (cssWidth <= 0) return;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const isDark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const axisColor = isDark ? "#9ca3af" : "#737373";

  // Compute Y domain.
  let yMax = yMinIn + 1;
  if (yMaxIn === "auto") {
    let max = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.t < from || p.t > to) continue;
        if (p.v > max) max = p.v;
      }
    }
    if (!Number.isFinite(max) || max <= yMinIn) max = yMinIn + 1;
    yMax = max * 1.1;
  } else {
    yMax = yMaxIn;
  }
  const yRange = yMax - yMinIn;

  const pad = { t: 12, r: 12, b: 18, l: 36 };
  const w = cssWidth;
  const h = cssHeight;
  const innerLeft = pad.l;
  const innerTop = pad.t;
  const innerRight = w - pad.r;
  const innerBottom = h - pad.b;
  const innerW = innerRight - innerLeft;
  const innerH = innerBottom - innerTop;

  // Grid lines + Y labels.
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = axisColor;
  ctx.font = "9px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= gridLineCount; i += 1) {
    const y = innerTop + (innerH * i) / gridLineCount;
    ctx.beginPath();
    ctx.moveTo(innerLeft, y);
    ctx.lineTo(innerRight, y);
    ctx.stroke();
    const value = yMax - (yRange * i) / gridLineCount;
    ctx.fillText(formatValue(value, yUnit), innerLeft - 4, y);
  }

  // Plot each series.
  const xRange = to - from;
  if (xRange <= 0) return;

  for (const s of series) {
    if (s.points.length === 0) continue;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    let started = false;
    for (const p of s.points) {
      if (p.t < from || p.t > to) continue;
      const x = innerLeft + ((p.t - from) / xRange) * innerW;
      const yClamped = Math.max(yMinIn, Math.min(yMax, p.v));
      const y = innerBottom - ((yClamped - yMinIn) / yRange) * innerH;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  let formatted: string;
  if (abs >= 1000) formatted = v.toFixed(0);
  else if (abs >= 100) formatted = v.toFixed(0);
  else if (abs >= 10) formatted = v.toFixed(1);
  else formatted = v.toFixed(2);
  return `${formatted}${unit}`;
}
