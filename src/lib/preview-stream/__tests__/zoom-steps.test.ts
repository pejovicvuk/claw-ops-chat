import { describe, expect, it } from "vitest";
import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  clampZoom,
  formatZoomPercent,
  nextZoomIn,
  nextZoomOut,
} from "../zoom-steps";

describe("ZOOM_STEPS", () => {
  it("is sorted ascending", () => {
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1]);
    }
  });

  it("includes 1.0 — the default reset target — exactly", () => {
    expect(ZOOM_STEPS).toContain(1.0);
    expect(ZOOM_DEFAULT).toBe(1.0);
  });
});

describe("nextZoomIn", () => {
  it("advances from one ladder step to the next", () => {
    expect(nextZoomIn(1.0)).toBe(1.1);
    expect(nextZoomIn(1.1)).toBe(1.25);
    expect(nextZoomIn(0.5)).toBe(0.67);
  });

  it("rounds an in-between value up to the next ladder step", () => {
    // 1.07 is between 1.0 and 1.1; zoom-in should land on 1.1.
    expect(nextZoomIn(1.07)).toBe(1.1);
    // 0.85 is between 0.8 and 0.9; zoom-in lands on 0.9.
    expect(nextZoomIn(0.85)).toBe(0.9);
  });

  it("clamps at the maximum — no overshoot", () => {
    expect(nextZoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(nextZoomIn(99)).toBe(ZOOM_MAX);
  });

  it("absorbs floating-point noise around an exact step", () => {
    // 1.0 + 1e-10 should still treat 1.0 as the current step.
    expect(nextZoomIn(1.0 + 1e-10)).toBe(1.1);
  });
});

describe("nextZoomOut", () => {
  it("retreats one ladder step", () => {
    expect(nextZoomOut(1.0)).toBe(0.9);
    expect(nextZoomOut(1.5)).toBe(1.25);
  });

  it("rounds an in-between value down to the previous step", () => {
    expect(nextZoomOut(1.07)).toBe(1.0);
    expect(nextZoomOut(0.85)).toBe(0.8);
  });

  it("clamps at the minimum", () => {
    expect(nextZoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(nextZoomOut(0.01)).toBe(ZOOM_MIN);
  });
});

describe("clampZoom", () => {
  it("returns the value unchanged when in-range", () => {
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("clamps below the minimum", () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(-1)).toBe(ZOOM_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
  });

  it("falls back to default on non-finite input", () => {
    expect(clampZoom(NaN)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Infinity)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(-Infinity)).toBe(ZOOM_DEFAULT);
  });
});

describe("formatZoomPercent", () => {
  it("formats whole-number percents", () => {
    expect(formatZoomPercent(1.0)).toBe("100%");
    expect(formatZoomPercent(1.5)).toBe("150%");
    expect(formatZoomPercent(0.5)).toBe("50%");
  });

  it("rounds fractional percents to the nearest integer", () => {
    expect(formatZoomPercent(0.67)).toBe("67%");
    expect(formatZoomPercent(0.333)).toBe("33%");
    // 1.256 (not 1.255 — that lands on the IEEE-754 lower-half due to
    // the binary representation of 0.255) rounds up to 126%.
    expect(formatZoomPercent(1.256)).toBe("126%");
  });
});
