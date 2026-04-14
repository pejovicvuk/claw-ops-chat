import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

interface SessionEntry {
  sessionId: string;
  display: string;
  timestamp: number;
}

export async function GET(request: Request) {
  const token = extractBearerToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const projectsDir = join(homedir(), ".claude", "projects");
  const sessions: SessionEntry[] = [];

  try {
    const projectDirs = await readdir(projectsDir).catch(() => [] as string[]);

    for (const projDir of projectDirs) {
      const projPath = join(projectsDir, projDir);
      const projStat = await stat(projPath).catch(() => null);
      if (!projStat?.isDirectory()) continue;

      const files = await readdir(projPath).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.replace(".jsonl", "");
        const filePath = join(projPath, file);

        try {
          const fileStat = await stat(filePath);
          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n").filter(Boolean);

          // Find the first user message for display
          let display = "New conversation";
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === "human" || entry.role === "user") {
                const text = typeof entry.message === "string"
                  ? entry.message
                  : entry.message?.content || entry.content || "";
                if (text) {
                  display = text.slice(0, 100);
                  break;
                }
              }
            } catch { /* skip malformed lines */ }
          }

          sessions.push({
            sessionId,
            display,
            timestamp: fileStat.mtimeMs,
          });
        } catch { /* skip unreadable files */ }
      }
    }

    // Sort newest first
    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return Response.json(sessions.slice(0, 50));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list sessions" },
      { status: 500 },
    );
  }
}
