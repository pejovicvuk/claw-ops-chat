import type { SessionStatus } from "@/lib/session-status-store";

/**
 * Slim per-session view used by /api/sessions/branches and consumed by
 * the branch-list UI. Mirrors the shape returned by SessionManager's
 * `listBranchSnapshots()` and the disk-fallback walk so the client only
 * needs one type.
 */
export interface SessionBranchSnapshot {
  sessionId: string;
  claudeSessionId: string | null;
  branchName: string | null;
  sessionCwd: string | null;
  status: SessionStatus;
  display: string;
}

export interface SessionBranchesResponse {
  sessions: SessionBranchSnapshot[];
}
