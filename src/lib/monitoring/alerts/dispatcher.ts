import { sendToAll } from "../../push/send";
import { getAuditWriter } from "../../audit/writer";
import { PerRuleWebhookChannel } from "./webhook-channel";
import type { AlertEvent, AlertRule } from "../types";

/**
 * Dispatches firing/resolved alert events to configured notification
 * channels. v1: web push + per-rule webhook. The Channel interface is
 * pluggable so email + SMS can be added later as new files.
 */
export interface AlertChannel {
  name: string;
  isEnabled(): boolean;
  send(event: AlertEvent): Promise<void>;
}

export interface DispatchEnvelope {
  event: AlertEvent;
  rule: AlertRule;
}

export class AlertDispatcher {
  private readonly webPush = new WebPushChannel();
  private readonly webhook = new PerRuleWebhookChannel();

  async dispatch(envelopes: DispatchEnvelope[]): Promise<void> {
    for (const env of envelopes) {
      // Hydrate the event with the rule's runbookUrl so downstream
      // channels (and the UI) can render it without an extra lookup.
      env.event.runbookUrl = env.rule.runbookUrl;
      await this.fanOut(env);
      await this.audit(env.event.state === "firing" ? "alert_fired" : "alert_resolved", env.event);
    }
  }

  private async fanOut(env: DispatchEnvelope): Promise<void> {
    // Web Push respects per-rule notify.webPush flag.
    if (env.rule.notify.webPush !== false) {
      await this.runChannel(this.webPush, env);
    }
    // Per-rule webhook only fires when the URL is configured.
    if (env.rule.notify.webhook?.url) {
      this.webhook.rule = env.rule;
      await this.runChannel(this.webhook, env);
    }
  }

  private async runChannel(channel: AlertChannel, env: DispatchEnvelope): Promise<void> {
    if (!channel.isEnabled()) return;
    try {
      await channel.send(env.event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await getAuditWriter()
        .alert({
          type: "notify_failed",
          severity: "warn",
          actor: "system",
          subject: `Alert notify failed (${channel.name}): ${env.rule.name}`,
          durationMs: null,
          ruleId: env.rule.id,
          ruleName: env.rule.name,
          details: { channel: channel.name, error: msg },
        })
        .catch(() => {});
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
          runbookUrl: event.runbookUrl,
        },
      })
      .catch(() => {});
  }
}

export class WebPushChannel implements AlertChannel {
  readonly name = "webPush";

  isEnabled(): boolean {
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
      {
        title,
        body,
        kind: "monitoringAlert",
        tagKey: `alert-${event.ruleId}`,
        url: event.runbookUrl,
      },
      "monitoringAlert",
    );
  }
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return n.toFixed(1);
}
