import { readFile, stat } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  deleteRunSidecar,
  readIndex,
  readRunSidecar,
  removeIndexEntry,
} from "@/lib/reports/run-store";
import { safePath, SafePathError } from "@/lib/safe-path";
import { unlink } from "fs/promises";
import { existsSync } from "fs";

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/;

type Params = { params: Promise<{ runId: string }> };

async function findRunEntry(runId: string) {
  const index = await readIndex();
  return index.runs.find((e) => e.runId === runId) ?? null;
}

/**
 * Return the markdown content of a report + its metadata. Truncates the
 * body at 1MB and surfaces a `truncated` flag so the reader UI can offer
 * a download link instead of trying to render a giant document on mobile.
 */
export async function GET(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { runId } = await ctx.params;
  if (!RUN_ID_RE.test(runId)) {
    return Response.json({ error: "Invalid runId" }, { status: 400 });
  }
  const entry = await findRunEntry(runId);
  if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
  const sidecar = await readRunSidecar(entry.jobId, runId);

  let content: string | null = null;
  let truncated = false;
  let sizeBytes = 0;
  if (entry.reportPath) {
    try {
      const safe = await safePath(entry.reportPath);
      const fileStat = await stat(safe);
      sizeBytes = fileStat.size;
      if (fileStat.size > 1_000_000) {
        const buf = await readFile(safe);
        content = buf.slice(0, 1_000_000).toString("utf-8");
        truncated = true;
      } else {
        content = await readFile(safe, "utf-8");
      }
    } catch (err) {
      if (err instanceof SafePathError) {
        return Response.json({ error: "Access denied" }, { status: 403 });
      }
      // File missing or unreadable — return metadata with content: null
    }
  }

  return Response.json({
    run: sidecar,
    indexEntry: entry,
    content,
    truncated,
    sizeBytes,
  });
}

export async function DELETE(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { runId } = await ctx.params;
  if (!RUN_ID_RE.test(runId)) {
    return Response.json({ error: "Invalid runId" }, { status: 400 });
  }
  const entry = await findRunEntry(runId);
  if (!entry) return Response.json({ error: "Not found" }, { status: 404 });

  // Best-effort delete of the output markdown file.
  if (entry.reportPath) {
    try {
      const safe = await safePath(entry.reportPath);
      if (existsSync(safe)) await unlink(safe);
    } catch {
      /* leave orphans alone — not worth 500ing here */
    }
  }
  await deleteRunSidecar(entry.jobId, runId);
  await removeIndexEntry(runId);
  return Response.json({ ok: true });
}
