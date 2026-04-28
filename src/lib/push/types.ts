export type PushEventKind =
  | "turnComplete"
  | "permissionRequest"
  | "error"
  | "cronComplete"
  | "monitoringAlert";

export const ALL_EVENT_KINDS: PushEventKind[] = [
  "turnComplete",
  "permissionRequest",
  "error",
  "cronComplete",
  "monitoringAlert",
];

export interface EventPreferences {
  turnComplete: boolean;
  permissionRequest: boolean;
  error: boolean;
  cronComplete: boolean;
  monitoringAlert: boolean;
}

export const DEFAULT_PREFERENCES: EventPreferences = {
  turnComplete: true,
  permissionRequest: true,
  error: true,
  cronComplete: true,
  monitoringAlert: true,
};

/**
 * How the SW should behave when a push arrives and the tab is focused.
 *
 * - `alwaysShow`  — system notification fires every time, even when the
 *                   focused tab is on the same chat the push is for.
 * - `smartChat`   — system notification fires when no tab is focused OR
 *                   when the focused tab is viewing a different chat.
 *                   In-app toast only when focused on the same chat.
 *                   This is the default.
 * - `suppress`    — system notification only when no tab is focused.
 *                   Any focused tab degrades to an in-app toast.
 */
export type FocusBehavior = "alwaysShow" | "smartChat" | "suppress";

export const ALL_FOCUS_BEHAVIORS: FocusBehavior[] = ["alwaysShow", "smartChat", "suppress"];

export interface BehaviorPreferences {
  focusBehavior: FocusBehavior;
}

export const DEFAULT_BEHAVIOR: BehaviorPreferences = {
  focusBehavior: "smartChat",
};

export interface PushKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: PushKeys;
}

export interface DeviceRecord {
  /** Stable per browser — sha256(endpoint).slice(0, 16). */
  id: string;
  endpoint: string;
  keys: PushKeys;
  /** Human label, defaults to a UA-derived "Chrome on macOS"-style string. */
  label: string;
  createdAt: number;
  lastSeenAt: number;
  events: EventPreferences;
  behavior: BehaviorPreferences;
}

/**
 * Public projection sent to the client — never reveals `endpoint` or `keys`
 * (those are secrets that would let anyone impersonate this device).
 */
export interface DeviceSummary {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  events: EventPreferences;
  behavior: BehaviorPreferences;
  /** Whether this is the calling browser (matches the supplied endpoint). */
  isThisDevice?: boolean;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Used for `notification.tag` (replaces a previous notification of same kind). */
  kind: PushEventKind;
  /** Optional URL to open on click; defaults to "/chat". */
  url?: string;
  /**
   * Stable key (typically a session id or report slug) appended to the
   * notification tag so independent events with the same kind don't
   * collapse onto one another. Optional — falls back to the kind alone.
   */
  tagKey?: string;
  /**
   * When true, the SW finds any open notification with the matching tag
   * and closes it without showing a new one. Used when a permission was
   * resolved from another tab and the stale prompt should disappear.
   */
  closeOnly?: boolean;
  /**
   * When true, the SW shows the system notification even if the tab is
   * focused, and skips the in-app `push-suppressed` toast path. Set by
   * the test endpoint so a user sitting on the settings page can verify
   * their OS-level notifications work without alt-tabbing first.
   */
  forceShow?: boolean;
  /**
   * The chat session this notification is about. Used by the SW with
   * `focusBehavior: "smartChat"` to decide whether the focused tab is
   * viewing the same chat (suppress) or a different one (show). Absent
   * for non-chat events (cron, monitoring) — those fall through to "show".
   */
  chatId?: string;
  /**
   * Per-device focus behavior, injected by the server from the device's
   * stored `BehaviorPreferences` so the SW doesn't need to read IndexedDB
   * on the push critical path. Defaults to `smartChat` when missing.
   */
  focusBehavior?: FocusBehavior;
}
