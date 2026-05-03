import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { contentDisposition } from "@/lib/content-disposition";
import {
  cancelDownload,
  clearInFlight,
  getDownload,
  markInFlight,
} from "@/lib/preview-stream/download-relay";

/**
 * Phase 3d (#129) HTTP serve route for preview downloads.
 *
 * The WS handler intercepts a Chromium-side download via
 * `page.on("download")`, registers it in the global registry with an
 * unguessable UUID, and emits `{type:"download_ready", id, …}` over
 * the WS. The client constructs `<a href="/chat/api/preview-download/<id>"
 * download={filename}>` and clicks it — we land here, stream the
 * temp file out with `Content-Disposition: attachment`, and the
 * browser's native download UI takes over.
 *
 * Auth: extractSession + per-entry actorEmail check. UUID alone
 * isn't enough — a UUID leak (history, log, accidental share)
 * shouldn't grant cross-actor access. 404 (not 403) on mismatch
 * to avoid leaking "valid id, wrong owner".
 *
 * Lifecycle: markInFlight on stream start (suspends sweeper);
 * clearInFlight on stream "close" (re-arms 5-min cleanup); an abort
 * during streaming triggers cancelDownload (immediate cleanup).
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getHandler(request: Request, context: RouteContext): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const { id } = await context.params;
  const entry = getDownload(id, session.email);
  if (!entry) {
    // Single 404 covers all failure modes (UUID-invalid, no-such-id,
    // wrong owner) — don't leak which one.
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Stat the file fresh — entry.size was captured at register time;
  // we use the live value for Content-Length so the browser shows
  // a real progress bar.
  let size: number;
  try {
    const s = await stat(entry.path);
    size = s.size;
  } catch {
    // File vanished between register + GET (e.g. swept by cron).
    // Drop the dead entry and 404.
    void cancelDownload(entry.id);
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  markInFlight(entry.id);

  // Stream the file. The native ReadStream is a Node Readable; convert
  // to a Web ReadableStream so Next.js' Response can consume it.
  const nodeStream = createReadStream(entry.path);
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      nodeStream.on("end", () => {
        controller.close();
        clearInFlight(entry.id);
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
        clearInFlight(entry.id);
      });
      // Propagate client aborts (closed tab, network drop) into the
      // file stream so we don't keep reading bytes nobody wants.
      request.signal?.addEventListener("abort", () => {
        nodeStream.destroy();
      });
    },
    cancel() {
      nodeStream.destroy();
      clearInFlight(entry.id);
    },
  });

  return new Response(webStream, {
    headers: {
      "Content-Disposition": contentDisposition(entry.suggestedFilename),
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
    },
  });
}

export const GET = withAudit(
  {
    route: "/api/preview-download",
    auditSuccessGets: true,
    subjectFrom: (req) => {
      // /chat/api/preview-download/<id> → just the id for the audit subject
      const parts = new URL(req.url).pathname.split("/");
      return parts[parts.length - 1] ?? null;
    },
  },
  getHandler,
);
