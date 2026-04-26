import { sendToAll } from "../../push/send";
import { getAuditWriter } from "../../audit/writer";
import type { AlertEvent } from "../types";

/**
 * Dispatches firing/resolved alert events to configured notification
 * channels. v1: web push only. The Channel interface is pluggable so
 * webhook + email can be added later as new files.
 */
export interface AlertChannel {
  name: string;
  isEnabled(): boolean;
  send(event: AlertEvent): Promise<void>;
}

export class AlertDispatcher {
  constructor(private readonly channels: AlertChannel[]) {}

  async dispatch(events: { fired: AlertEvent[]; resolved: AlertEvent[] }): Promise<void> {
    for (const ev of events.fired) {
      await this.send(ev);
      await this.audit("alert_fired", ev);
    }
    for (const ev of events.resolved) {
      await this.send(ev);
      await this.audit("alert_resolved", ev);
    }
  }

  private async send(event: AlertEvent): Promise<void> {
    for (const channel of this.channels) {
      if (!channel.isEnabled()) continue;
      try {
        await channel.send(event);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await getAuditWriter()
          .alert({
            type: "notify_failed",
            severity: "warn",
            actor: "system",
            subject: `Alert notify failed (${channel.name}): ${event.ruleName}`,
            durationMs: null,
            ruleId: event.ruleId,
            ruleName: event.ruleName,
            details: { channel: channel.name, error: msg },
          })
          .catch(() => {});
      }
    }
  }

  private async audit(type: "alert_fired" | "alert_resolved", event: AlertEvent): Promise<void> {
    await getAuditWriter()
      .alert({
        type,
        severity:
          type === "alert_fired" ? (event.severity === "critical" ? "error" : "warn") : "info",
        actor: "system",
        subject:
          type === "alert_fired"
            ? `Alert fired: ${event.ruleName} (${event.observedValue} ${event.severity})`
            : `Alert resolved: ${event.ruleName}`,
        durationMs: event.resolvedAt && event.firedAt ? event.resolvedAt - event.firedAt : null,
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        observedValue: event.observedValue,
        thresholdValue: event.threshold,
        details: {
          state: event.state,
          severity: event.severity,
          observedValue: event.observedValue,
          threshold: event.threshold,
        },
      })
      .catch(() => {});
  }
}

export class WebPushChannel implements AlertChannel {
  readonly name = "webPush";

  isEnabled(): boolean {
    // Always available — relies on existing subscription list.
    return true;
  }

  async send(event: AlertEvent): Promise<void> {
    const isFiring = event.state === "firing";
    const title = isFiring
      ? `${event.severity === "critical" ? "[critical]" : "[warning]"} ${event.ruleName}`
      : `Resolved: ${event.ruleName}`;
    const body = isFiring
      ? `Observed ${formatValue(event.observedValue)} (threshold ${formatValue(event.threshold)})`
      : `Returned to normal${
          event.resolvedAt && event.firedAt
            ? ` after ${Math.round((event.resolvedAt - event.firedAt) / 1000)}s`
            : ""
        }.`;
    await sendToAll(
      { title, body, kind: "monitoringAlert", tagKey: `alert-${event.ruleId}` },
      "monitoringAlert",
    );
  }
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return n.toFixed(1);
}
