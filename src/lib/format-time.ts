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
