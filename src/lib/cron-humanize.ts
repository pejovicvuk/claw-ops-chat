import cronstrue from "cronstrue";

/**
 * Convert a cron expression to human-readable English.
 *
 * Wrapper around cronstrue so the rest of the app doesn't import the lib
 * directly — if we ever want to swap implementations or add i18n, it
 * happens here.
 */
export function humanizeCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { use24HourTimeFormat: false });
  } catch {
    return "Invalid cron expression";
  }
}

/**
 * Compute the next N fire times (ISO strings) for a cron expression.
 *
 * Uses cron-parser v5's `CronExpressionParser.parse(...)` API. The earlier
 * `parseExpression` entry point was removed in v5 — before this fix our
 * import resolved to undefined and every call silently returned `[]`,
 * which is why the dashboard never showed a "next run" time and the
 * editor's schedule preview was blank.
 *
 * Returns an empty array on any parse error so callers can render
 * "Invalid" without a try/catch.
 */
export async function nextRunTimes(expr: string, timezone: string, count = 3): Promise<string[]> {
  try {
    const mod = (await import("cron-parser")) as {
      CronExpressionParser?: {
        parse: (
          expr: string,
          options: { tz?: string; currentDate?: Date },
        ) => { next: () => { toISOString: () => string } };
      };
    };
    const Parser = mod.CronExpressionParser;
    if (!Parser || typeof Parser.parse !== "function") {
      console.warn("[cron-humanize] CronExpressionParser.parse not found in cron-parser module");
      return [];
    }
    const iter = Parser.parse(expr, { tz: timezone, currentDate: new Date() });
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(iter.next().toISOString());
    }
    return out;
  } catch (err) {
    // Log once per call so a malformed expression (or a DST edge case)
    // is visible in container logs rather than silently blank in the UI.
    console.warn(
      `[cron-humanize] nextRunTimes failed for "${expr}" (${timezone}):`,
      (err as Error).message,
    );
    return [];
  }
}
