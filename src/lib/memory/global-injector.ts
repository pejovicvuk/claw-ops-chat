import { readFile } from "fs/promises";
import { join } from "path";

import { globalMemoryDir } from "./paths";
import { listMemoryFiles } from "./store";

/**
 * Build the system-prompt append fragment that carries global memory
 * into every Claude turn.
 *
 * Concatenates every `.md` file under `globalMemoryDir()` into a single
 * `# Global Memory` block, mirroring the `# Project Rules` block built
 * by `getCustomAppendForSdk` in `src/lib/agent-config.ts`. Never throws
 * — returns "" on any I/O error so a corrupt memory file never breaks
 * a chat turn.
 */
export async function getGlobalMemoryAppend(): Promise<string> {
  let files;
  try {
    files = await listMemoryFiles(globalMemoryDir());
  } catch {
    return "";
  }
  if (files.length === 0) return "";

  const blocks: string[] = ["# Global Memory"];
  for (const file of files) {
    let content = "";
    try {
      content = await readFile(join(globalMemoryDir(), file.path), "utf-8");
    } catch {
      continue;
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    blocks.push(`## ${file.path}\n\n${trimmed}`);
  }
  return blocks.length > 1 ? blocks.join("\n\n") : "";
}
