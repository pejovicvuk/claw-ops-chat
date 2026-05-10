import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { runConsolidator } from "@/lib/memory/consolidator";

/**
 * POST /api/memory/auto/regenerate — run the auto-collected memory
 * consolidator immediately against the most-recently-modified transcript
 * found under ~/.claude/projects/. Surfaces the resulting outcome so the
 * UI can render an "added N facts" toast.
 *
 * The body may optionally include `{ transcriptPath: string }` to target
 * a specific transcript; otherwise we pick the global most-recent.
 */

async function findMostRecentTranscript(): Promise<string | null> {
  const projectsDir = join(homedir(), ".claude", "projects");
  let bestPath: string | null = null;
  let bestMtime = -Infinity;

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return null;
  }

  for (const projectDir of projectDirs) {
    const abs = join(projectsDir, projectDir);
    let entries: string[];
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = join(abs, entry);
      try {
        const info = await stat(file);
        if (info.isFile() && info.mtimeMs > bestMtime) {
          bestMtime = info.mtimeMs;
          bestPath = file;
        }
      } catch {
        /* skip */
      }
    }
  }
  return bestPath;
}

async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

  let body: { transcriptPath?: unknown } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let transcriptPath: string | null;
  if (typeof body.transcriptPath === "string" && body.transcriptPath.length > 0) {
    // Restrict to the same directory tree we'd auto-pick from to avoid
    // arbitrary read of any host file. The validation is intentional:
    // anyone with a session cookie can already read host files via the
    // file-browser, but the consolidator pipeline shouldn't be the back
    // door for that.
    const expectedRoot = join(homedir(), ".claude", "projects");
    if (!body.transcriptPath.startsWith(expectedRoot + "/")) {
      return Response.json(
        { error: "transcriptPath must be under ~/.claude/projects/" },
        { status: 400 },
      );
    }
    transcriptPath = body.transcriptPath;
  } else {
    transcriptPath = await findMostRecentTranscript();
  }

  if (!transcriptPath) {
    return Response.json({ error: "No transcript found" }, { status: 404 });
  }

  const outcome = await runConsolidator(transcriptPath);
  return Response.json({ outcome, transcriptPath });
}

export const POST = withAudit(
  {
    route: "/api/memory/auto/regenerate",
    label: "Regenerate auto-collected memory",
  },
  postHandler,
);
