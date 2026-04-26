/**
 * Human-readable formatters used across monitoring UI. Server-friendly
 * (no DOM dependencies); reused from API responses' `formattedValue`
 * fields and the React components.
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 0) return "0 B";
  if (bytes < KB) return `${bytes.toFixed(0)} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(fractionDigits)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(fractionDigits)} MB`;
  if (bytes < TB) return `${(bytes / GB).toFixed(fractionDigits)} GB`;
  return `${(bytes / TB).toFixed(fractionDigits)} TB`;
}

export function formatBytesPerSec(bytes: number): string {
  return `${formatBytes(bytes, 1)}/s`;
}

export function formatPercent(pct: number, fractionDigits = 1): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct.toFixed(fractionDigits)}%`;
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) {
    const m = Math.floor(min);
    const s = Math.round(sec - m * 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const hr = min / 60;
  if (hr < 24) {
    const h = Math.floor(hr);
    const m = Math.round(min - h * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(hr / 24);
  const remHr = Math.round(hr - days * 24);
  return remHr > 0 ? `${days}d ${remHr}h` : `${days}d`;
}

export function formatRate(perSec: number, unit = "/s"): string {
  if (!Number.isFinite(perSec)) return "—";
  if (perSec < 1) return `${perSec.toFixed(2)}${unit}`;
  if (perSec < 100) return `${perSec.toFixed(1)}${unit}`;
  return `${perSec.toFixed(0)}${unit}`;
}

export function formatTimeAgo(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < 1000) return "just now";
  return `${formatDurationMs(diff)} ago`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

export function clampPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  const pct = (value / total) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}
