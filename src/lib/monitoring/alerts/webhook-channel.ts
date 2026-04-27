import { assertPublicUrl } from "../../proxy/ssrf-guard";
import type { AlertChannel } from "./dispatcher";
import type { AlertEvent, AlertRule } from "../types";

/**
 * POSTs alerts to a per-rule webhook URL. Compatible with Slack,
 * Discord, and PagerDuty Events API v2 — recipients receive a JSON
 * envelope with the alert payload + structured fields.
 *
 * Every URL passes through the existing `assertPublicUrl()` SSRF guard
 * so a compromised rule can't ping internal hosts (10/8, 169.254/16, etc.).
 */
export class PerRuleWebhookChannel implements AlertChannel {
  readonly name = "webhook";
  /** Set by the dispatcher before each `send()` call. */
  rule: AlertRule | null = null;

  isEnabled(): boolean {
    return Boolean(this.rule?.enabled && this.rule.notify.webhook?.url);
  }

  async send(event: AlertEvent): Promise<void> {
    const url = this.rule?.notify.webhook?.url;
    if (!url) return;
    try {
      await assertPublicUrl(url);
    } catch (err) {
      throw new Error(
        `Webhook URL rejected by SSRF guard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const payload = buildPayload(event, this.rule);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Webhook POST returned ${res.status}`);
    }
  }
}

interface WebhookPayload {
  schema: "claw-monitoring/alert/v1";
  event: AlertEvent;
  ruleName: string;
  ruleId: string;
  runbookUrl?: string;
  /** Slack-friendly text rendering — many incoming webhooks pick this up automatically. */
  text: string;
  /** Datadog/Slack/PagerDuty-friendly summary. */
  summary: string;
}

function buildPayload(event: AlertEvent, rule: AlertRule | null): WebhookPayload {
  const verb = event.state === "firing" ? "fired" : "resolved";
  const summary = `[${event.severity}] ${event.ruleName} ${verb}: observed ${event.observedValue} (threshold ${event.threshold})`;
  const text = event.runbookUrl ? `${summary}\nRunbook: ${event.runbookUrl}` : summary;
  return {
    schema: "claw-monitoring/alert/v1",
    event,
    ruleName: event.ruleName,
    ruleId: event.ruleId,
    runbookUrl: event.runbookUrl ?? rule?.runbookUrl,
    text,
    summary,
  };
}
