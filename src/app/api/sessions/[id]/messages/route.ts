import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { extractSession, unauthorized } from "@/lib/auth-server";

interface MessageEntry {
  id: string;
  role: "user" | "assistant";
  type: "text";
  content: string;
  timestamp: number;
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!extractSession(request)) return unauthorized();

  const { id: sessionId } = await params;
  const projectsDir = join(homedir(), ".claude", "projects");
  const messages: MessageEntry[] = [];

  try {
    // Find the session file across all project directories
    const projectDirs = await readdir(projectsDir).catch(() => [] as string[]);
    let sessionFile: string | null = null;

    for (const projDir of projectDirs) {
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

    return Response.json(messages);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read session" },
      { status: 500 },
    );
  }
}
