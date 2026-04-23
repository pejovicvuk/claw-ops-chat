import { type ChildProcess } from "child_process";

/**
 * Minimal interface over either a Node.js `child_process.ChildProcess` or
 * a `node-pty` `IPty`, covering just the operations the Claude auth flow
 * needs: write to stdin, kill, observe exit + output, read liveness.
 *
 * Introduced because the pipe-spawned ChildProcess path wedges on CLI
 * versions that only accept the OAuth paste-code through a raw TTY.
 * Spawning via node-pty fixes that, but the `/login` and `/submit-code`
 * routes and the in-memory session map all touched `child.stdin` /
 * `child.stdout` / `child.exitCode` directly — cleaning that up behind
 * a tiny adapter lets the two backends share every call site.
 */
export interface LoginSubprocess {
  /** OS pid; undefined if the subprocess never started. */
  readonly pid: number | undefined;
  /**
   * Exit code once the process has ended, null while still running.
   * Kept in sync with child.exitCode for the ChildProcess backend and
   * tracked by an exit-listener for the PTY backend.
   */
  readonly exitCode: number | null;
  /** True after kill() has been called or the process has exited. */
  readonly killed: boolean;
  /**
   * Write bytes to the subprocess's stdin. Always appends '\n' — the
   * Claude CLI's prompt reader expects a newline-terminated code.
   * Throws if the stream is closed / the PTY has exited.
   */
  write(data: string): void;
  /** Send SIGTERM (or equivalent). Safe to call on an already-dead process. */
  kill(): void;
  /**
   * Subscribe to stdout+stderr lines (ChildProcess) or all PTY output
   * (PTY). The callback gets raw chunks — caller is responsible for any
   * line-splitting they need.
   */
  onData(cb: (chunk: string) => void): void;
  /** Subscribe to process exit. Fires exactly once. */
  onClose(cb: (code: number | null) => void): void;
  /**
   * Subscribe to errors that prevented the subprocess from running at
   * all (e.g. spawn ENOENT). Not every backend surfaces this — PTY
   * bundles spawn errors into the exit event — but matching the
   * ChildProcess shape keeps the wiring in login/route.ts uniform.
   */
  onError(cb: (err: Error) => void): void;
}

/** Adapt a Node.js ChildProcess to the LoginSubprocess shape. */
export function adaptChildProcess(child: ChildProcess): LoginSubprocess {
  return {
    get pid() {
      return child.pid;
    },
    get exitCode() {
      return child.exitCode;
    },
    get killed() {
      return child.killed;
    },
    write(data) {
      const stdin = child.stdin;
      if (!stdin || stdin.destroyed) {
        throw new Error("stdin is closed");
      }
      stdin.write(data);
    },
    kill() {
      if (!child.killed) child.kill();
    },
    onData(cb) {
      child.stdout?.on("data", (chunk: Buffer) => cb(chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => cb(chunk.toString()));
    },
    onClose(cb) {
      child.on("close", (code) => cb(code));
    },
    onError(cb) {
      child.on("error", cb);
    },
  };
}

/** Adapt a node-pty IPty to the LoginSubprocess shape. */
export function adaptPty(pty: import("node-pty").IPty): LoginSubprocess {
  // node-pty's IPty doesn't expose an `exitCode` field; capture it via
  // the onExit listener. Same for `killed` — we track the flag ourselves
  // because .kill() doesn't mutate any observable PTY state.
  let exitCode: number | null = null;
  let terminated = false;
  pty.onExit(({ exitCode: code }) => {
    exitCode = code;
    terminated = true;
  });
  return {
    get pid() {
      return pty.pid;
    },
    get exitCode() {
      return exitCode;
    },
    get killed() {
      return terminated;
    },
    write(data) {
      if (terminated) throw new Error("PTY has exited");
      pty.write(data);
    },
    kill() {
      if (terminated) return;
      try {
        pty.kill();
      } catch {
        /* already dead */
      }
      terminated = true;
    },
    onData(cb) {
      pty.onData(cb);
    },
    onClose(cb) {
      pty.onExit(({ exitCode: code }) => cb(code));
    },
    onError() {
      /* node-pty surfaces spawn errors via onExit with a non-zero code;
         nothing to wire here, kept for API parity. */
    },
  };
}

/**
 * Lazy-load node-pty. Native binding — may not be present on dev
 * Windows machines without the prebuilt wheel, so we cache both the
 * module and any load error and let callers fall back gracefully.
 * Mirrors the identical helper in server.ts:40 so both surfaces stay
 * in sync.
 */
type NodePty = typeof import("node-pty");
let ptyModuleCache: NodePty | null = null;
let ptyLoadErrorCache: Error | null = null;

export function loadPtyModule(): NodePty {
  if (ptyModuleCache) return ptyModuleCache;
  if (ptyLoadErrorCache) throw ptyLoadErrorCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node-pty has a native binding; dynamic require lets us probe its presence and skip gracefully when the wheel isn't installed (dev Windows)
    ptyModuleCache = require("node-pty") as NodePty;
    return ptyModuleCache;
  } catch (err) {
    ptyLoadErrorCache = err instanceof Error ? err : new Error("Failed to load node-pty");
    throw ptyLoadErrorCache;
  }
}

/** Non-throwing variant — null when node-pty isn't available. */
export function tryLoadPtyModule(): NodePty | null {
  try {
    return loadPtyModule();
  } catch {
    return null;
  }
}
