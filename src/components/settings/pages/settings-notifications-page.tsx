"use client";

import { useCallback, useState } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiBell,
  FiBellOff,
  FiCheck,
  FiChevronDown,
  FiChevronRight,
  FiInfo,
  FiLoader,
  FiRefreshCw,
  FiSend,
  FiSmartphone,
  FiTrash2,
} from "react-icons/fi";
import {
  ALL_EVENT_KINDS,
  type EventPreferences,
  type PushEventKind,
} from "@/lib/push/types";
import { usePushDiagnostics } from "@/lib/push/use-push-diagnostics";
import { usePushSubscription } from "@/lib/push/use-push-subscription";
import { useSwRegistrationStatus } from "@/lib/push/use-sw-registration";
import { toast } from "@/lib/use-toast";
import type { DeviceSummary } from "@/lib/push/types";

const EVENT_LABELS: Record<PushEventKind, { title: string; description: string }> = {
  turnComplete: {
    title: "Claude finished responding",
    description: "Fires when a long task or chat turn completes.",
  },
  permissionRequest: {
    title: "Permission requested",
    description: "Claude is paused waiting for you to approve a tool.",
  },
  error: {
    title: "Errors and crashes",
    description: "Session errors or unexpected disconnects.",
  },
  cronComplete: {
    title: "Scheduled report finished",
    description: "A cron job from Settings → Reports completed a run.",
  },
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function SettingsNotificationsPage() {
  const sub = usePushSubscription();
  const swStatus = useSwRegistrationStatus();

  const handleEnable = useCallback(() => {
    void sub.enable();
  }, [sub]);

  const handleDisable = useCallback(() => {
    void sub.disable();
  }, [sub]);

  const handleClearAll = useCallback(() => {
    if (confirm("Remove all registered devices? Each one will stop receiving notifications.")) {
      void sub.clearAll();
    }
  }, [sub]);

  if (sub.support.kind === "unsupported") {
    return (
      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="mb-1 flex items-center gap-2">
          <FiAlertTriangle size={14} className="text-yellow-500" />
          <span className="text-[13px] font-medium text-canvas-fg">Not supported</span>
        </div>
        <p className="text-[12px] text-canvas-muted">{sub.support.reason}</p>
      </div>
    );
  }

  if (sub.loading) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  const enabled = !!sub.thisDevice;

  return (
    <div className="space-y-4">
      <ServiceWorkerStatusRow status={swStatus.status} error={swStatus.error} />

      <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          {enabled ? (
            <FiBell size={14} className="text-accent" />
          ) : (
            <FiBellOff size={14} className="text-canvas-muted" />
          )}
          <span className="text-[13px] font-medium text-canvas-fg">
            {enabled ? "Notifications are on for this device" : "Notifications are off"}
          </span>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
          Web Push is delivered by your browser&rsquo;s vendor service (Chrome, Firefox, Safari)
          using a free VAPID-signed channel. The server stores one record per device so you can
          enable notifications on as many phones / laptops as you like.
        </p>
        {sub.error && (
          <p className="mb-3 flex items-center gap-1 text-[11px] text-red-500">
            <FiAlertTriangle size={11} />
            {sub.error}
          </p>
        )}
        {sub.permission === "denied" && (
          <p className="mb-3 flex items-center gap-1 rounded-md bg-yellow-500/10 px-2.5 py-2 text-[11px] text-yellow-700 dark:text-yellow-300">
            <FiInfo size={11} />
            The browser has blocked notifications. Allow them in site settings, then return here.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <button
              type="button"
              onClick={handleDisable}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
            >
              <FiBellOff size={11} />
              Disable on this device
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEnable}
              disabled={sub.enabling || sub.permission === "denied"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
            >
              {sub.enabling ? (
                <>
                  <FiLoader size={11} className="animate-spin" />
                  Requesting permission…
                </>
              ) : (
                <>
                  <FiBell size={11} />
                  Enable on this device
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {enabled && sub.thisDevice && (
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <FiSmartphone size={14} className="text-canvas-muted" />
            <span className="text-[13px] font-medium text-canvas-fg">
              This device&rsquo;s preferences
            </span>
          </div>
          <div className="space-y-2">
            {ALL_EVENT_KINDS.map((kind) => (
              <EventCheckbox
                key={kind}
                kind={kind}
                checked={sub.thisDevice!.events[kind]}
                onChange={(v) => void sub.setPrefs({ [kind]: v } as Partial<EventPreferences>)}
              />
            ))}
          </div>
        </div>
      )}

      {enabled && sub.thisDevice && (
        <TestNotificationsCard prefs={sub.thisDevice.events} sendTest={sub.sendTest} />
      )}

      {enabled && <RecentDeliveriesPanel />}

      {sub.allDevices.length > 0 && (
        <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium text-canvas-fg">Registered devices</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:underline"
            >
              <FiTrash2 size={10} />
              Unregister all
            </button>
          </div>
          <div className="space-y-1.5">
            {sub.allDevices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                onRemove={() => void sub.removeDevice(d.id)}
                onTogglePref={(kind, value) =>
                  void sub.setDevicePrefs(d.id, { [kind]: value } as Partial<EventPreferences>)
                }
              />
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-canvas-muted">
        Notifications are suppressed automatically when this tab is focused — an in-app toast
        appears instead. The server stores subscriptions at{" "}
        <code>/root/.config/push-subscriptions.json</code>; never sent to a third party.
      </p>
    </div>
  );
}

interface ServiceWorkerStatusRowProps {
  status: ReturnType<typeof useSwRegistrationStatus>["status"];
  error: string | null;
}

function ServiceWorkerStatusRow({ status, error }: ServiceWorkerStatusRowProps) {
  if (status === "active") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-[11px] text-green-700 dark:text-green-300">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
        Service worker active — push delivery should be reliable.
      </div>
    );
  }
  if (status === "installing" || status === "idle") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-canvas-border bg-canvas-surface px-3 py-2 text-[11px] text-canvas-muted">
        <FiLoader size={11} className="animate-spin" />
        Service worker installing…
      </div>
    );
  }
  if (status === "unsupported") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-700 dark:text-yellow-300">
        <FiAlertTriangle size={11} />
        Service workers aren&rsquo;t available in this browser — push notifications won&rsquo;t work.
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
      <FiAlertTriangle size={11} className="mt-0.5 shrink-0" />
      <span>
        Service worker {status === "redundant" ? "is redundant" : "registration failed"}.{" "}
        {error || "Try a hard reload (Ctrl/Cmd-Shift-R) to recover."}
      </span>
    </div>
  );
}

interface TestNotificationsCardProps {
  prefs: EventPreferences;
  sendTest: (kind: PushEventKind) => Promise<void>;
}

function TestNotificationsCard({ prefs, sendTest }: TestNotificationsCardProps) {
  const [pending, setPending] = useState<PushEventKind | null>(null);
  const handleTest = useCallback(
    async (kind: PushEventKind) => {
      setPending(kind);
      try {
        await sendTest(kind);
        toast.success(`Test sent for ${EVENT_LABELS[kind].title}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Test send failed");
      } finally {
        setPending(null);
      }
    },
    [sendTest],
  );

  return (
    <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <FiSend size={14} className="text-canvas-muted" />
        <span className="text-[13px] font-medium text-canvas-fg">Send a test notification</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-canvas-muted">
        Picks the channel directly so you can verify each toggle independently. Tests always
        produce a system notification (even with this tab focused) so you can confirm OS-level
        delivery without alt-tabbing first.
      </p>
      <div className="flex flex-wrap gap-2">
        {ALL_EVENT_KINDS.map((kind) => {
          const enabled = prefs[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => void handleTest(kind)}
              disabled={!enabled || pending !== null}
              title={enabled ? `Send a test for ${EVENT_LABELS[kind].title}` : "Channel disabled — toggle it on above first"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-2.5 py-1.5 text-[11px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
            >
              {pending === kind ? (
                <FiLoader size={10} className="animate-spin" />
              ) : (
                <FiSend size={10} />
              )}
              {EVENT_LABELS[kind].title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecentDeliveriesPanel() {
  const [open, setOpen] = useState(false);
  const diag = usePushDiagnostics();
  return (
    <div className="rounded-xl border border-canvas-border bg-canvas-surface p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="text-canvas-muted">
          {open ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
        </span>
        <FiActivity size={14} className="text-canvas-muted" />
        <span className="text-[13px] font-medium text-canvas-fg">
          Recent deliveries
          {diag.entries.length > 0 && (
            <span className="ml-2 text-[11px] text-canvas-muted">({diag.entries.length})</span>
          )}
        </span>
        {open && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void diag.refresh();
            }}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-canvas-muted hover:text-canvas-fg"
          >
            <FiRefreshCw size={10} className={diag.loading ? "animate-spin" : ""} />
            Refresh
          </button>
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-1.5">
          {diag.error && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={11} />
              {diag.error}
            </p>
          )}
          {!diag.error && diag.entries.length === 0 && !diag.loading && (
            <p className="text-[11px] text-canvas-muted">
              No deliveries yet. Send a test notification to see one here.
            </p>
          )}
          {diag.entries.map((e, i) => (
            <div
              key={`${e.ts}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md border border-canvas-border bg-canvas-bg px-2 py-1.5 text-[11px]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <OutcomeBadge outcome={e.outcome} />
                <span className="truncate text-canvas-fg">{EVENT_LABELS[e.kind].title}</span>
              </div>
              <span className="shrink-0 truncate text-canvas-muted" title={e.device}>
                {e.device}
              </span>
              <span className="shrink-0 text-canvas-muted">{relTime(e.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: "sent" | "dropped" | "error" }) {
  const cls =
    outcome === "sent"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : outcome === "dropped"
        ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
        : "bg-red-500/15 text-red-600 dark:text-red-400";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {outcome}
    </span>
  );
}

interface EventCheckboxProps {
  kind: PushEventKind;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function EventCheckbox({ kind, checked, onChange }: EventCheckboxProps) {
  const meta = EVENT_LABELS[kind];
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 hover:bg-canvas-surface-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
      />
      <div className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-canvas-fg">{meta.title}</span>
        <span className="block text-[10px] text-canvas-muted">{meta.description}</span>
      </div>
    </label>
  );
}

interface DeviceRowProps {
  device: DeviceSummary;
  onRemove: () => void;
  onTogglePref: (kind: PushEventKind, value: boolean) => void;
}

function DeviceRow({ device, onRemove, onTogglePref }: DeviceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const enabledCount = ALL_EVENT_KINDS.filter((k) => device.events[k]).length;

  return (
    <div className="overflow-hidden rounded-lg border border-canvas-border bg-canvas-bg">
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${device.label}` : `Expand ${device.label}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-canvas-surface-hover"
        >
          <span className="shrink-0 text-canvas-muted">
            {expanded ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12px] font-medium text-canvas-fg">
                {device.label}
              </span>
              {device.isThisDevice && (
                <span className="inline-flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent">
                  <FiCheck size={8} />
                  this
                </span>
              )}
            </div>
            <span className="block text-[10px] text-canvas-muted">
              Active {relTime(device.lastSeenAt)} · added {relTime(device.createdAt)} ·{" "}
              {enabledCount}/{ALL_EVENT_KINDS.length} events
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${device.label}`}
          className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-red-500 transition-colors hover:bg-red-500/10"
        >
          <FiTrash2 size={11} />
          Remove
        </button>
      </div>
      {expanded && (
        <div className="space-y-1.5 border-t border-canvas-border bg-canvas-surface/40 p-2">
          {ALL_EVENT_KINDS.map((kind) => (
            <EventCheckbox
              key={kind}
              kind={kind}
              checked={device.events[kind]}
              onChange={(v) => onTogglePref(kind, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
