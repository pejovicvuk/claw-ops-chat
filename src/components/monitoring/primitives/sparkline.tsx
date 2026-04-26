"use client";

import { useMemo } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  filled?: boolean;
  /** Force min/max instead of computing from values. */
  domain?: [number, number] | "auto";
  /** Render a small dot at the latest data point. */
  showLastPoint?: boolean;
  ariaLabel: string;
  className?: string;
}

/**
 * Pure-SVG sparkline. Memoized — repeated renders with the same `values`
 * reference do no work. Designed for 30+ on screen at once.
 */
export function Sparkline({
  values,
  width = 80,
  height = 24,
  color,
  filled = false,
  domain = "auto",
  showLastPoint = false,
  ariaLabel,
  className,
}: SparklineProps) {
  const { points, lastX, lastY, min, max } = useMemo(() => {
    if (values.length === 0) {
      return { points: "", lastX: 0, lastY: 0, min: 0, max: 0 };
    }
    let min: number;
    let max: number;
    if (domain === "auto") {
      min = Math.min(...values);
      max = Math.max(...values);
    } else {
      [min, max] = domain;
    }
    if (max === min) max = min + 1;
    const padding = 1;
    const usableHeight = height - padding * 2;
    const stepX = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values
      .map((v, i) => {
        const x = i * stepX;
        const y = padding + ((max - v) / (max - min)) * usableHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const lastIdx = values.length - 1;
    const lastX = lastIdx * stepX;
    const lastY = padding + ((max - values[lastIdx]) / (max - min)) * usableHeight;
    return { points, lastX, lastY, min, max };
  }, [values, width, height, domain]);

  if (values.length === 0) {
    return (
      <div role="img" aria-label={ariaLabel} className={className} style={{ width, height }} />
    );
  }

  const stroke = color ?? "var(--mon-spark-default)";

  return (
    <svg
      role="img"
      aria-label={`${ariaLabel} (${values.length} samples, ${formatNumber(min)} to ${formatNumber(max)})`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: "visible" }}
    >
      {filled ? (
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill="var(--mon-area-fill)"
          stroke="none"
        />
      ) : null}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showLastPoint ? <circle cx={lastX} cy={lastY} r={1.5} fill={stroke} /> : null}
    </svg>
  );
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(1);
}
