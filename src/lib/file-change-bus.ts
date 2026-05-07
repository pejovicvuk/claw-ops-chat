/**
 * Lightweight pub/sub for "this file path changed" notifications.
 *
 * Producer: `useClaudeChat`'s WebSocket handler dispatches a
 * `file_changed` server event into `emitFileChange`.
 *
 * Consumers: components observing a specific file (the editor panel,
 * the `useFileStat` cache) subscribe via `subscribeFileChange(path,
 * callback)` and receive only events for their path.
 *
 * Why a module-level singleton, not React context: a context provider
 * would force every consumer down a single subtree, but the editor
 * panel mounts as a portal-style overlay and `useFileStat` is also
 * called from list/preview components that render outside the chat
 * subtree. A singleton keeps the surface small and lets any component
 * subscribe without prop drilling. SSR-safe because all calls happen
 * inside `"use client"` modules / effects.
 */

export interface FileChangeEvent {
  /** Realpath as canonicalized server-side via safePath(). */
  path: string;
  /** New on-disk mtime; `null` when the file was deleted in the same turn. */
  mtimeMs: number | null;
  /** Origin of the change. "claude" today; reserved for "ui"/"external" later. */
  source: string;
  /** True when the file no longer exists on disk. */
  deleted: boolean;
}

type Listener = (event: FileChangeEvent) => void;

const subscribers = new Map<string, Set<Listener>>();

/**
 * Subscribe to changes for one path. Returns an unsubscribe function;
 * call it from a useEffect cleanup so the bus doesn't leak handlers
 * across remounts.
 */
export function subscribeFileChange(path: string, listener: Listener): () => void {
  let set = subscribers.get(path);
  if (!set) {
    set = new Set();
    subscribers.set(path, set);
  }
  set.add(listener);
  return () => {
    const current = subscribers.get(path);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(path);
  };
}

/**
 * Fan out an event to every subscriber of its path. No-op when nothing
 * is subscribed. Listener errors are isolated so a buggy subscriber
 * cannot break peers (or the calling websocket handler).
 */
export function emitFileChange(event: FileChangeEvent): void {
  const set = subscribers.get(event.path);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      /* keep delivery flowing to remaining subscribers */
    }
  }
}

/**
 * Test helper — clears every subscriber. Production code should never
 * call this; tests use it in `beforeEach` to keep state isolated.
 */
export function _resetFileChangeBus(): void {
  subscribers.clear();
}
