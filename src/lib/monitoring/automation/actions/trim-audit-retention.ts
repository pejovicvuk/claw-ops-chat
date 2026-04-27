import { purgeOldAuditFiles } from "../../../audit/retention";
import type { AutomationActionFn } from "../types";

/**
 * Forces a one-shot audit purge using the configured `maxAgeDays`.
 * Reuses the existing `purgeOldAuditFiles()` from the audit subsystem.
 */
export const trimAuditRetention: AutomationActionFn = async (ctx) => {
  const days = typeof ctx.rule.options.maxAgeDays === "number" ? ctx.rule.options.maxAgeDays : 30;
  const maxAgeMs = days * 24 * 60 * 60 * 1000;
  try {
    const result = await purgeOldAuditFiles(maxAgeMs);
    return {
      ok: true,
      summary: `Purged ${result.deleted.length} audit file(s), freed ${formatBytes(result.bytesFreed)}`,
      details: { deleted: result.deleted, bytesFreed: result.bytesFreed, days },
    };
  } catch (err) {
    return {
      ok: false,
      summary: `Audit purge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
