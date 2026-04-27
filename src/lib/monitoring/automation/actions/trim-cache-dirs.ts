import { purgeOldImages } from "../../../proxy/image-cache";
import { purgeOldUnfurls } from "../../../proxy/unfurl-cache";
import type { AutomationActionFn } from "../types";

/**
 * Sweeps the unfurl + image preview caches under /root/.cache/. Reuses
 * the existing purge helpers; counts deleted entries.
 */
export const trimCacheDirs: AutomationActionFn = async () => {
  let unfurlsDeleted = 0;
  let imagesDeleted = 0;
  let bytesFreed = 0;
  try {
    const u = await purgeOldUnfurls();
    unfurlsDeleted = u.deleted ?? 0;
  } catch (err) {
    return {
      ok: false,
      summary: `Unfurl purge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const i = await purgeOldImages();
    imagesDeleted = i.deleted ?? 0;
    bytesFreed = i.bytesFreed ?? 0;
  } catch (err) {
    return {
      ok: false,
      summary: `Image purge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    ok: true,
    summary: `Pruned ${unfurlsDeleted} unfurl(s) + ${imagesDeleted} image(s), freed ${(bytesFreed / (1024 * 1024)).toFixed(1)} MB`,
    details: { unfurlsDeleted, imagesDeleted, bytesFreed },
  };
};
