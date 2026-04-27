import { writeFile } from "fs/promises";
import type { AutomationActionFn } from "../types";

const DROP_PATH = "/proc/sys/vm/drop_caches";

/**
 * Tells the kernel to drop page cache + dentries + inodes. Equivalent
 * to `echo 1 > /proc/sys/vm/drop_caches`. Reduces RSS pressure but
 * temporarily slows IO until caches warm back up.
 *
 * Requires the container to have write access to /proc/sys, which most
 * deployments don't. Returns a clean failure when /proc is read-only.
 */
export const dropFsCaches: AutomationActionFn = async () => {
  try {
    await writeFile(DROP_PATH, "1\n", "utf-8");
    return {
      ok: true,
      summary: "Wrote 1 to /proc/sys/vm/drop_caches (kernel caches dropped)",
    };
  } catch (err) {
    return {
      ok: false,
      summary: `Could not write ${DROP_PATH}: ${err instanceof Error ? err.message : String(err)}. Container needs read-write /proc.`,
    };
  }
};
