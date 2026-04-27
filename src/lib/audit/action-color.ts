/**
 * Maps an audit event's subject (or any free-form description) to a
 * Tailwind text-color class. Mirrors the semantic colouring the FE uses
 * on its admin audit log: red for failures, amber for destructive
 * actions, green for creations / successes, default canvas-fg otherwise.
 */
export function actionColorClass(subject: string): string {
  if (!subject) return "text-canvas-fg";
  if (/_FAILED|error|denied|unauthorized|reject/i.test(subject)) {
    return "text-[var(--mon-critical)]";
  }
  if (/DELETE|delete\s|disable|remove|purge|kill|stop|drop/i.test(subject)) {
    return "text-[var(--mon-warning)]";
  }
  if (/CREATE|create|login\b|granted|complete|success|ok\b/i.test(subject)) {
    return "text-[var(--mon-healthy)]";
  }
  return "text-canvas-fg";
}
