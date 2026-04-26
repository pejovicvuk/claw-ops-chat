import { describe, expect, it } from "vitest";
import { AlertEvaluator } from "./evaluator";
import type { AlertRule } from "../types";

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  const now = Date.now();
  return {
    id: "rule_1",
    name: "Test rule",
    enabled: true,
    metric: "system.cpu.aggregatePct",
    operator: ">",
    threshold: 50,
    forMs: 60_000,
    severity: "warning",
    notify: { webPush: true },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("AlertEvaluator", () => {
  it("does not fire below threshold", () => {
    const ev = new AlertEvaluator();
    const out = ev.tick([rule()], () => 25, Date.now());
    expect(out.fired).toHaveLength(0);
    expect(out.resolved).toHaveLength(0);
  });

  it("does not fire above threshold until forMs elapses", () => {
    const ev = new AlertEvaluator();
    const t0 = Date.now();
    let out = ev.tick([rule()], () => 80, t0);
    expect(out.fired).toHaveLength(0);
    out = ev.tick([rule()], () => 80, t0 + 30_000);
    expect(out.fired).toHaveLength(0);
    out = ev.tick([rule()], () => 80, t0 + 60_500);
    expect(out.fired).toHaveLength(1);
    expect(out.fired[0].state).toBe("firing");
  });

  it("resolves when value drops back well below threshold", () => {
    const ev = new AlertEvaluator();
    const t0 = Date.now();
    ev.tick([rule()], () => 80, t0);
    ev.tick([rule()], () => 80, t0 + 60_500);
    const out = ev.tick([rule()], () => 25, t0 + 90_000);
    expect(out.resolved).toHaveLength(1);
    expect(out.resolved[0].state).toBe("resolved");
  });

  it("does not resolve while in hysteresis band", () => {
    const ev = new AlertEvaluator();
    const t0 = Date.now();
    ev.tick([rule()], () => 80, t0);
    ev.tick([rule()], () => 80, t0 + 60_500);
    const out = ev.tick([rule()], () => 49, t0 + 90_000);
    expect(out.resolved).toHaveLength(0);
  });

  it("respects snoozedUntil", () => {
    const ev = new AlertEvaluator();
    const t0 = Date.now();
    const r = rule({ snoozedUntil: t0 + 120_000 });
    ev.tick([r], () => 80, t0);
    const out = ev.tick([r], () => 80, t0 + 60_500);
    expect(out.fired).toHaveLength(0);
  });

  it("does not evaluate disabled rules", () => {
    const ev = new AlertEvaluator();
    const t0 = Date.now();
    const r = rule({ enabled: false });
    const out = ev.tick([r], () => 200, t0 + 60_500);
    expect(out.fired).toHaveLength(0);
  });

  it("supports < operator", () => {
    const ev = new AlertEvaluator();
    const t0 = Date.now();
    const r = rule({ operator: "<", threshold: 10 });
    ev.tick([r], () => 5, t0);
    const out = ev.tick([r], () => 5, t0 + 60_500);
    expect(out.fired).toHaveLength(1);
  });
});
