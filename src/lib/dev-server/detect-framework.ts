import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { DetectionResult, Framework, RunSpec } from "./types";

/**
 * Inspect an item folder's `package.json` and return a framework guess
 * + a suggested run command. Used by the PreviewWindow's "Start"
 * button to know what to spawn and what default port to expect.
 *
 * Detection priority is roughly "most opinionated framework first" so
 * a Vite + React project resolves to Vite (not generic React).
 *
 * Always returns SOMETHING — falls back to `unknown` + a generic
 * `npm run dev` invocation if nothing is recognizable.
 */

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Maps framework → its default port when nothing else specifies one. */
const DEFAULT_PORTS: Record<Framework, number> = {
  next: 3000,
  vite: 5173,
  cra: 3000,
  nestjs: 3000,
  astro: 4321,
  nuxt: 3000,
  "node-script": 3000,
  unknown: 3000,
};

export async function detectFramework(itemDir: string): Promise<DetectionResult> {
  const pkgPath = join(itemDir, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      framework: "unknown",
      defaultPort: DEFAULT_PORTS.unknown,
      runSpec: makeRunSpec("unknown", DEFAULT_PORTS.unknown),
    };
  }

  let pkg: PackageJson;
  try {
    const raw = await readFile(pkgPath, "utf-8");
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    // Malformed package.json — treat as unknown so the user can still
    // type a port and try `npm run dev` manually.
    return {
      framework: "unknown",
      defaultPort: DEFAULT_PORTS.unknown,
      runSpec: makeRunSpec("unknown", DEFAULT_PORTS.unknown),
    };
  }

  const framework = pickFramework(pkg);
  const defaultPort = DEFAULT_PORTS[framework];
  return {
    framework,
    defaultPort,
    runSpec: makeRunSpec(framework, defaultPort),
  };
}

/**
 * Pick a framework from package.json contents. Order matters:
 * the more opinionated framework wins (Next > React, Vite > Vue, etc.).
 */
function pickFramework(pkg: PackageJson): Framework {
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  if ("next" in allDeps) return "next";
  if ("vite" in allDeps) return "vite";
  if ("react-scripts" in allDeps) return "cra";
  if ("@nestjs/core" in allDeps) return "nestjs";
  if ("astro" in allDeps) return "astro";
  if ("nuxt" in allDeps || "nuxt3" in allDeps) return "nuxt";

  // Generic fallback: if the package has a `dev` script we'll just
  // shell out via `npm run dev`. Tag it `node-script` so the UI can
  // display "Custom dev script" instead of "Unknown".
  if (pkg.scripts && typeof pkg.scripts.dev === "string") return "node-script";

  return "unknown";
}

/**
 * Build a `RunSpec` for the given framework + port. PORT-override
 * convention varies per framework:
 *   - Next / CRA / NestJS / Nuxt — read PORT env var
 *   - Vite / Astro — pass `--port N` after `--`
 *   - node-script / unknown — set PORT env (best-effort) AND don't
 *     pass --port (avoids breaking custom scripts that don't accept it)
 */
function makeRunSpec(framework: Framework, port: number): RunSpec {
  switch (framework) {
    case "next":
    case "cra":
    case "nestjs":
    case "nuxt":
      return {
        command: "npm",
        args: ["run", "dev"],
        env: { PORT: String(port) },
      };
    case "vite":
    case "astro":
      return {
        command: "npm",
        args: ["run", "dev", "--", "--port", String(port)],
        env: {},
      };
    case "node-script":
    case "unknown":
      return {
        command: "npm",
        args: ["run", "dev"],
        env: { PORT: String(port) },
      };
  }
}
