import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { consolidatorProjectDirName } from "@/lib/memory/paths";
import {
  snapshotFromAssistantUsage,
  DEFAULT_CONTEXT_WINDOW,
  type AssistantUsage,
  type ContextUsageSnapshot,
} from "@/lib/context-usage";

interface MessageEntry {
  id: string;
  role: "user" | "assistant";
  type: "text";
  content: string;
  timestamp: number;
}

interface SessionMessagesResponse {
  messages: MessageEntry[];
  contextUsage: ContextUsageSnapshot | null;
  /** Original cwd used when the session was created — needed for SDK resume. */
  sessionCwd: string | null;
}

/** Extract plain text from a Claude Code message content field */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }
    return textParts.join("\n");
  }
  return "";
}

type RouteCtx = { params: Promise<{ id: string }> };

async function getHandler(request: Request, { params }: RouteCtx): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  const { id: sessionId } = await params;
  const projectsDir = join(homedir(), ".claude", "projects");
  const messages: MessageEntry[] = [];
  // Latest assistant `usage` field seen while walking the JSONL. Each
  // assistant entry overwrites this — the LAST value wins, never a sum.
  // (Summing across messages was the cause of the "1253 % of 1 M" bug
  // on the live broadcast path; keep this read path matching that fix.)
  const usageRef: { value: { usage: AssistantUsage; model: string } | null } = { value: null };
  // Track original cwd from the JSONL — needed for SDK resume to find the session.
  const cwdRef: { value: string | null } = { value: null };

  try {
    // Find the session file across all project directories. Skip the
    // consolidator's stub project dir so a stale stub JSONL from the
    // auto-memory subsystem can't satisfy a sessionId lookup.
    const projectDirs = await readdir(projectsDir).catch(() => [] as string[]);
    const skipDir = consolidatorProjectDirName();
    let sessionFile: string | null = null;

    for (const projDir of projectDirs) {
      if (projDir === skipDir) continue;
      const candidate = join(projectsDir, projDir, `${sessionId}.jsonl`);
      const s = await stat(candidate).catch(() => null);
      if (s?.isFile()) {
        sessionFile = candidate;
        break;
      }
    }

    if (!sessionFile) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const content = await readFile(sessionFile, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    let counter = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Capture the cwd from the first entry that has it (all entries share the same cwd).
        if (!cwdRef.value && typeof entry.cwd === "string" && entry.cwd) {
          cwdRef.value = entry.cwd;
        }

        // User messages — two formats:
        //   CLI: {type: "user", message: {role: "user", content: "plain string"}}
        //   SDK: {type: "user", message: {role: "user", content: [{type: "text", text: "..."}, ...]}}
        // Skip: tool_result-only arrays, slash commands, XML command tags
        if (entry.type === "user" && entry.message?.role === "user") {
          const raw = entry.message.content;
          let text = "";
          if (typeof raw === "string") {
            text = raw;
          } else if (Array.isArray(raw)) {
            // Extract text blocks, skip if only tool_results
            const textParts: string[] = [];
            for (const block of raw) {
              if (block.type === "text" && typeof block.text === "string") {
                textParts.push(block.text);
              }
            }
            text = textParts.join("\n");
          }
          // Skip empty, slash commands, and XML command tags
          if (!text || text.startsWith("/") || text.startsWith("<")) continue;
          messages.push({
            id: `hist-${counter++}`,
            role: "user",
            type: "text",
            content: text,
            timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
          });
        }

        // Assistant messages: {type: "assistant", message: {role: "assistant", content: [{type: "text", text: "..."}, ...]}}
        if (entry.type === "assistant" && entry.message?.role === "assistant") {
          // Track latest usage for context indicator. Overwrite — never
          // sum across turns. snapshotFromAssistantUsage builds the
          // public shape from this when the file walk finishes.
          const usage = entry.message.usage;
          if (usage && typeof usage === "object") {
            usageRef.value = {
              usage: usage as AssistantUsage,
              model: entry.message.model || "",
            };
          }
          const text = extractText(entry.message.content);
          if (text) {
            messages.push({
              id: `hist-${counter++}`,
              role: "assistant",
              type: "text",
              content: text,
              timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
            });
          }
        }
      } catch {
        /* skip malformed lines */
      }
    }

    // Build the context-usage snapshot from the LAST assistant
    // `usage` we saw. The JSONL doesn't carry an authoritative
    // contextWindow (that lives in `result.modelUsage`, which Claude
    // Code persists separately), so we fall back to the 1 M default.
    // Live WS broadcasts later override this with the real cap.
    const contextUsage: ContextUsageSnapshot | null = usageRef.value
      ? snapshotFromAssistantUsage(
          usageRef.value.usage,
          usageRef.value.model || null,
          DEFAULT_CONTEXT_WINDOW,
        )
      : null;

    const response: SessionMessagesResponse = {
      messages,
      contextUsage,
      sessionCwd: cwdRef.value,
    };
    return Response.json(response);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read session" },
      { status: 500 },
    );
  }
}

export const GET = withAudit<RouteCtx>(
  {
    route: "/api/sessions/[id]/messages",
    auditSuccessGets: true,
    subjectFrom: (req) => {
      // Extract the session id from the URL path: /…/sessions/<id>/messages
      const match = new URL(req.url).pathname.match(/\/sessions\/([^/]+)\/messages/);
      return match?.[1] ?? null;
    },
  },
  getHandler,
);
