import { spawn, type ChildProcess } from "child_process";
import { itemDir } from "../projects/paths";
import { detectFramework } from "./detect-framework";
import type { Framework, RunningServer, RunSpec, StartRequest } from "./types";

/**
 * Server-side registry of dev-server processes spawned by the
 * PreviewWindow's Start button. One singleton Map keyed by
 * `${projectSlug}/${itemSlug}/${port}`. Lifecycle:
 *
 *   start()  -> spawn, capture stdio, parse for "ready" signal
 *   stop()   -> SIGTERM, escalate to SIGKILL after 5 s if alive
 *   list()   -> all currently-tracked servers
 *
 * The registry lives in process memory only — a chat-server restart
 * forgets every spawned server. The user re-clicks Start to bring
 * them back. (Acceptable: dev servers are fast to start, and
 * persisting child PIDs across restarts is a tar pit.)
 *
 * Process-spawn pattern mirrors `bitbucket-mcp.ts:26-49` (chunked
 * stdio + on-close cleanup). Long-lived rather than promise-resolved
 * because dev servers don't exit voluntarily.
 */

const READY_SIGNALS: Record<Framework, RegExp[]> = {
  next: [/Ready in/i, /started server on/i, /Local:.+http/i],
  vite: [/Local:.+http/i, /ready in/i],
  cra: [/Compiled successfully/i, /Local:.+http/i],
  nestjs: [/Nest application successfully started/i, /Listening on/i],
  astro: [/Local.+http/i, /astro.+ready/i],
  nuxt: [/Local:.+http/i, /Nuxt.+ready/i, /Listening/i],
  "node-script": [/listening|ready|started|Local:.+http/i],
  unknown: [/listening|ready|started|Local:.+http/i],
};

/**
 * Generic-fallback ready timer — if no signal fires within this
 * window we mark the server "ready" anyway so the UI can stop
 * spinning. Most dev servers print something within 1–2 s; 10 s is
 * generous for cold-start.
 */
const FALLBACK_READY_MS = 10_000;

/** Cap on the in-memory log buffer per server (oldest dropped). */
const LOG_CAP = 200;

/** SIGKILL escalation delay after SIGTERM. */
const STOP_KILL_AFTER_MS = 5_000;

interface InternalServer extends RunningServer {
  process: ChildProcess;
  /** Resolved when the process emits a known "ready" signal or the fallback timer fires. */
  readyTimer: ReturnType<typeof setTimeout> | null;
}

const servers = new Map<string, InternalServer>();

/**
 * Subscribers receive a copy of the registry on every state change
 * (start / stop / ready / log). Used by status polling endpoints and
 * (later) a WS broadcaster.
 */
type Subscriber = (servers: RunningServer[]) => void;
const subscribers = new Set<Subscriber>();

function emit(): void {
  const snapshot = list();
  for (const sub of subscribers) {
    try {
      sub(snapshot);
    } catch {
      /* one bad subscriber shouldn't break the others */
    }
  }
}

export function subscribe(cb: Subscriber): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/**
 * Public read-only snapshot of every tracked server. The internal
 * `process` + `readyTimer` fields are omitted — callers only see the
 * wire-friendly shape.
 */
export function list(): RunningServer[] {
  return Array.from(servers.values()).map(toWire);
}

export function get(id: string): RunningServer | null {
  const s = servers.get(id);
  return s ? toWire(s) : null;
}

export function getByPort(
  projectSlug: string,
  itemSlug: string,
  port: number,
): RunningServer | null {
  return get(`${projectSlug}/${itemSlug}/${port}`);
}

function toWire(s: InternalServer): RunningServer {
  return {
    id: s.id,
    projectSlug: s.projectSlug,
    itemSlug: s.itemSlug,
    port: s.port,
    framework: s.framework,
    pid: s.pid,
    startedAt: s.startedAt,
    readyAt: s.readyAt,
    lastLogs: [...s.lastLogs],
    actorEmail: s.actorEmail,
  };
}

interface StartOptions extends StartRequest {
  actorEmail: string;
  /**
   * Override for tests — when set, the spawn uses this run spec
   * instead of running framework detection. Production callers leave
   * it undefined.
   */
  runSpecOverride?: RunSpec;
  /**
   * Override for tests — when set, used as the spawn cwd + detection
   * root instead of `itemDir(projectSlug, itemSlug)`. Production
   * callers leave it undefined.
   */
  cwdOverride?: string;
}

export async function start(opts: StartOptions): Promise<RunningServer> {
  const cwd = opts.cwdOverride ?? itemDir(opts.projectSlug, opts.itemSlug);
  const port = opts.port ?? (await detectFramework(cwd)).defaultPort;
  const id = `${opts.projectSlug}/${opts.itemSlug}/${port}`;

  const existing = servers.get(id);
  if (existing) {
    // Already running on this port for this item — return the existing
    // record. The route handler can decide whether to 200 or 409.
    return toWire(existing);
  }

  const detection = await detectFramework(cwd);
  const framework = opts.framework ?? detection.framework;
  const runSpec = opts.runSpecOverride ?? detection.runSpec;

  const child = spawn(runSpec.command, runSpec.args, {
    cwd,
    env: { ...process.env, ...runSpec.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn dev server: ${runSpec.command} ${runSpec.args.join(" ")}`);
  }

  const internal: InternalServer = {
    id,
    projectSlug: opts.projectSlug,
    itemSlug: opts.itemSlug,
    port,
    framework,
    pid: child.pid,
    startedAt: Date.now(),
    readyAt: null,
    lastLogs: [],
    actorEmail: opts.actorEmail,
    process: child,
    readyTimer: setTimeout(() => {
      // Generic-fallback "ready" — if no signal fired in time, assume
      // the server is up so the UI can proceed. Many custom scripts
      // never print anything detectable.
      if (internal.readyAt === null) {
        internal.readyAt = Date.now();
        emit();
      }
    }, FALLBACK_READY_MS),
  };

  const onLine = (line: string) => {
    if (internal.lastLogs.length >= LOG_CAP) {
      internal.lastLogs.splice(0, internal.lastLogs.length - LOG_CAP + 1);
    }
    internal.lastLogs.push(line);
    if (internal.readyAt === null && isReadySignal(line, framework)) {
      internal.readyAt = Date.now();
      if (internal.readyTimer) {
        clearTimeout(internal.readyTimer);
        internal.readyTimer = null;
      }
    }
  };

  attachLineReader(child.stdout, onLine);
  attachLineReader(child.stderr, onLine);

  child.once("exit", (code, signal) => {
    if (internal.readyTimer) {
      clearTimeout(internal.readyTimer);
      internal.readyTimer = null;
    }
    servers.delete(id);
    onLine(
      signal ? `[dev-server exited via ${signal}]` : `[dev-server exited with code ${code ?? "?"}]`,
    );
    emit();
  });

  child.once("error", (err) => {
    onLine(`[dev-server spawn error: ${err.message}]`);
    if (internal.readyTimer) {
      clearTimeout(internal.readyTimer);
      internal.readyTimer = null;
    }
    servers.delete(id);
    emit();
  });

  servers.set(id, internal);
  emit();
  return toWire(internal);
}

export async function stop(id: string): Promise<{ exitCode: number | null }> {
  const server = servers.get(id);
  if (!server) return { exitCode: null };

  return new Promise((resolve) => {
    const child = server.process;
    let resolved = false;

    const finish = (code: number | null) => {
      if (resolved) return;
      resolved = true;
      resolve({ exitCode: code });
    };

    child.once("exit", (code) => finish(code));

    try {
      child.kill("SIGTERM");
    } catch {
      // Already dead — just clean up the registry.
      servers.delete(id);
      finish(null);
      return;
    }

    // Escalate to SIGKILL if SIGTERM didn't take effect.
    setTimeout(() => {
      if (resolved) return;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      // SIGKILL forces an exit, which fires the once("exit") above
      // and resolves the promise. If that somehow doesn't happen
      // within another second, give up and report null.
      setTimeout(() => finish(null), 1000);
    }, STOP_KILL_AFTER_MS);
  });
}

/**
 * Best-effort kill of every tracked server. Called from the chat
 * server's graceful-shutdown handler so a `docker stop` cleans up
 * spawned dev servers instead of orphaning them.
 */
export function killAll(): void {
  for (const server of servers.values()) {
    try {
      server.process.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    if (server.readyTimer) clearTimeout(server.readyTimer);
  }
  servers.clear();
}

function isReadySignal(line: string, framework: Framework): boolean {
  for (const re of READY_SIGNALS[framework]) {
    if (re.test(line)) return true;
  }
  return false;
}

/**
 * Splits a streaming Buffer into lines and invokes the callback for
 * each completed line. Carries the trailing partial across chunks.
 */
function attachLineReader(stream: NodeJS.ReadableStream | null, cb: (line: string) => void): void {
  if (!stream) return;
  let carry = "";
  stream.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    const combined = carry + text;
    const lines = combined.split(/\r?\n/);
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) cb(line);
    }
  });
  stream.on("end", () => {
    if (carry.length > 0) cb(carry);
    carry = "";
  });
}
