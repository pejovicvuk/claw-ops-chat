import { extractSession, unauthorized } from "@/lib/auth-server";
import { humanizeCron, nextRunTimes } from "@/lib/cron-humanize";
import { validateCronExpression } from "@/lib/reports/job-validator";

/**
 * Given a cron expression + timezone, return a human-readable description
 * and the next N fire times. Used for live preview in the New Job form
 * so the server (not the browser) owns cron-parser.
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const url = new URL(request.url);
  const expr = url.searchParams.get("expr") ?? "";
  const timezone = url.searchParams.get("timezone") ?? "UTC";
  const count = Math.max(1, Math.min(10, Number(url.searchParams.get("count") ?? "3")));

  const error = validateCronExpression(expr);
  if (error) {
    return Response.json({ valid: false, error });
  }

  const [human, nextRuns] = await Promise.all([
    Promise.resolve(humanizeCron(expr)),
    nextRunTimes(expr, timezone, count),
  ]);

  return Response.json({ valid: true, human, nextRuns });
}
