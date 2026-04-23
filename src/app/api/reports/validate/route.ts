import { extractSession, unauthorized } from "@/lib/auth-server";
import { parseJobMarkdown } from "@/lib/reports/job-parser";
import { validateJob } from "@/lib/reports/job-validator";

/**
 * Dry-run validation endpoint used by the editor for inline errors.
 * Never touches disk — pure parse + validate round trip.
 */
export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = (body as { markdown?: string })?.markdown;
  if (typeof content !== "string") {
    return Response.json({ error: "markdown body is required" }, { status: 400 });
  }
  try {
    const { job } = parseJobMarkdown(content);
    const errors = validateJob(job);
    return Response.json({ valid: errors.length === 0, errors, job });
  } catch (err) {
    return Response.json({
      valid: false,
      errors: [
        {
          field: "frontmatter",
          message: err instanceof Error ? err.message : "Parse failed",
        },
      ],
    });
  }
}
