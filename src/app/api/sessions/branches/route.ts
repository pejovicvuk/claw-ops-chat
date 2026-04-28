import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { loadAllSessions } from "@/lib/session-persistence";
import type {
  SessionBranchSnapshot,
  SessionBranchesResponse,
} from "@/lib/session-branches";

export const dynamic = "force-dynamic";

interface GlobalAccess {
  __clawListSessionBranches?: () => SessionBranchSnapshot[];
}

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const live = (globalThis as GlobalAccess).__clawListSessionBranches?.();
  if (live) {
    const body: SessionBranchesResponse = { sessions: live };
    return Response.json(body);
  }

  // Disk fallback for `next dev` (no SessionManager in scope) and any
  // boot path where the global hook isn't wired yet. Status is "idle"
  // because we don't have access to the in-memory status store.
  const persisted = await loadAllSessions();
  const sessions: SessionBranchSnapshot[] = persisted.map((p) => ({
    sessionId: p.id,
    claudeSessionId: p.claudeSessionId ?? null,
    branchName: p.branchName ?? null,
    sessionCwd: p.sessionCwd ?? null,
    status: "idle",
    display: p.lastUserMessage ? p.lastUserMessage.slice(0, 80) : "Chat",
  }));
  const body: SessionBranchesResponse = { sessions };
  return Response.json(body);
}

export const GET = withAudit({ route: "/api/sessions/branches" }, getHandler);
