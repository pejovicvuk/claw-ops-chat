/**
 * Shared types for the dev-server lifecycle subsystem.
 *
 * The dev-server manager spawns long-lived `npm run dev`-style
 * processes per item canvas, tracks them in a server-side registry,
 * and exposes Start / Stop / status to the PreviewWindow UI.
 */

export type Framework =
  | "next"
  | "vite"
  | "cra"
  | "nestjs"
  | "astro"
  | "nuxt"
  | "node-script"
  | "unknown";

/** A concrete spawn recipe — what to exec, with what args, what env. */
export interface RunSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What the framework detector returns for a given item folder. */
export interface DetectionResult {
  framework: Framework;
  /** Suggested default port if the user hasn't picked one. */
  defaultPort: number;
  /** A complete RunSpec that respects PORT-override conventions per framework. */
  runSpec: RunSpec;
}

/** Server-side record of one running dev-server process. */
export interface RunningServer {
  /**
   * Composite id `${projectSlug}/${itemSlug}/${port}`. Stable across
   * the process's lifetime; usable as a Map key.
   */
  id: string;
  projectSlug: string;
  itemSlug: string;
  port: number;
  framework: Framework;
  pid: number;
  /** epoch ms when the process was spawned. */
  startedAt: number;
  /**
   * epoch ms when stdout produced a "ready" signal (Vite "Local:",
   * Next "Ready in", CRA "Compiled successfully", or the 10 s
   * generic-fallback timer). null while still booting.
   */
  readyAt: number | null;
  /** Last 200 lines of stdout/stderr, oldest first. */
  lastLogs: string[];
  /** Email of the actor that started the server (for audit). */
  actorEmail: string;
}

/** Wire-format Start request body. */
export interface StartRequest {
  projectSlug: string;
  itemSlug: string;
  /** Optional — falls back to detection's `defaultPort`. */
  port?: number;
  /** Optional — falls back to auto-detection. */
  framework?: Framework;
}

/** Wire-format Stop request body. */
export interface StopRequest {
  id: string;
}

/** Wire-format response when a stop completes. */
export interface StopResponse {
  exitCode: number | null;
}

/** Wire-format response from `GET /api/dev-server`. */
export interface ListResponse {
  servers: RunningServer[];
}
