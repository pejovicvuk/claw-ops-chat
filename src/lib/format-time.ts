/**
 * Shared relative-time formatter used by both SessionList and ReportsList.
 * Extracted from src/components/chat/session-list.tsx so the two lists agree
 * to the minute on what "Just now" / "5m ago" / "3d ago" means.
 */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Forward-looking variant of formatRelativeTime — collapses "time until X"
 * to a short phrase like "in 4h 12m" / "in 3d 5h" / "in <1m".
 *
 * Used by the JobCard to show "Next in X" beside the execution counter so
 * the user can see when the next tick will fire without opening the
 * editor to inspect the cron expression.
 */
export function formatTimeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "due now";
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days >= 1) return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
  if (hours >= 1) return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  if (mins >= 1) return `in ${mins}m`;
  return "in <1m";
}
