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
 * cron-parser handles timezone + DST correctly. Returns an empty array
 * on any parse error so callers can render "Invalid" without a try/catch.
 */
export async function nextRunTimes(expr: string, timezone: string, count = 3): Promise<string[]> {
  try {
    // cron-parser's types vary across versions; tolerate both default-export
    // and named-export shapes via a dynamic import.
    const mod: unknown = await import("cron-parser");
    const parseExpression =
      (mod as { parseExpression?: (...a: unknown[]) => unknown }).parseExpression ??
      (mod as { default?: { parseExpression?: (...a: unknown[]) => unknown } }).default
        ?.parseExpression;
    if (typeof parseExpression !== "function") {
      return [];
    }
    const iter = parseExpression(expr, { tz: timezone, currentDate: new Date() }) as {
      next: () => { toISOString: () => string };
    };
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(iter.next().toISOString());
    }
    return out;
  } catch {
    return [];
  }
}
