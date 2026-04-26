"use client";

import { useCallback, useState } from "react";
import {
  FiAlertTriangle,
  FiBell,
  FiBellOff,
  FiCheck,
  FiChevronDown,
  FiChevronRight,
  FiInfo,
  FiLoader,
  FiSend,
  FiSmartphone,
  FiTrash2,
} from "react-icons/fi";
import { ALL_EVENT_KINDS, type EventPreferences, type PushEventKind } from "@/lib/push/types";
import { usePushSubscription } from "@/lib/push/use-push-subscription";
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
          {enabled && (
            <button
              type="button"
              onClick={() => void sub.sendTest()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiSend size={11} />
              Send test notification
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
        Notifications are suppressed automatically when this tab is focused — the in-app UI is
        enough. The server stores subscriptions at{" "}
        <code>/root/.config/push-subscriptions.json</code>; never sent to a third party.
      </p>
    </div>
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
