export type PushEventKind = "turnComplete" | "permissionRequest" | "error" | "cronComplete";

export const ALL_EVENT_KINDS: PushEventKind[] = [
  "turnComplete",
  "permissionRequest",
  "error",
  "cronComplete",
];

export interface EventPreferences {
  turnComplete: boolean;
  permissionRequest: boolean;
  error: boolean;
  cronComplete: boolean;
}

export const DEFAULT_PREFERENCES: EventPreferences = {
  turnComplete: true,
  permissionRequest: true,
  error: true,
  cronComplete: true,
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
}
