import { describe, expect, it } from "vitest";
import {
  Modifiers,
  _keyToCdpPayload,
  _mouseToCdpPayload,
  _wheelToCdpPayload,
} from "../input-forward";

describe("input-forward — payload translation", () => {
  it("maps mouse down → mousePressed with click count 1 by default", () => {
    expect(_mouseToCdpPayload({ action: "down", x: 10, y: 20, button: "left" })).toEqual({
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  });

  it("maps mouse up → mouseReleased", () => {
    expect(_mouseToCdpPayload({ action: "up", x: 5, y: 6, button: "right" })).toEqual({
      type: "mouseReleased",
      x: 5,
      y: 6,
      button: "right",
      buttons: 0,
      clickCount: 1,
    });
  });

  it("maps mouse move → mouseMoved with click count 0 by default", () => {
    expect(_mouseToCdpPayload({ action: "move", x: 100, y: 200, buttons: 1 })).toEqual({
      type: "mouseMoved",
      x: 100,
      y: 200,
      button: "none",
      buttons: 1,
      clickCount: 0,
    });
  });

  it("maps wheel events with both deltas", () => {
    expect(_wheelToCdpPayload({ x: 0, y: 0, deltaX: 0, deltaY: -120 })).toEqual({
      type: "mouseWheel",
      x: 0,
      y: 0,
      deltaX: 0,
      deltaY: -120,
      button: "none",
      buttons: 0,
    });
  });

  it("maps key down with modifiers", () => {
    const out = _keyToCdpPayload({
      action: "down",
      key: "a",
      code: "KeyA",
      text: "a",
      modifiers: Modifiers.Ctrl | Modifiers.Shift,
    });
    expect(out).toEqual({
      type: "keyDown",
      key: "a",
      code: "KeyA",
      text: "a",
      unmodifiedText: "a",
      modifiers: 10, // Ctrl(2) + Shift(8)
    });
  });

  it("maps non-character keys with no text", () => {
    const out = _keyToCdpPayload({
      action: "down",
      key: "Escape",
      code: "Escape",
    });
    expect(out.type).toBe("keyDown");
    expect(out.key).toBe("Escape");
    expect(out.text).toBeUndefined();
    expect(out.modifiers).toBe(0);
  });

  it("maps char events for IME-style typing", () => {
    const out = _keyToCdpPayload({ action: "char", key: "ñ", code: "", text: "ñ" });
    expect(out.type).toBe("char");
    expect(out.text).toBe("ñ");
  });

  it("Modifiers constants match CDP's expected mask values", () => {
    expect(Modifiers.Alt).toBe(1);
    expect(Modifiers.Ctrl).toBe(2);
    expect(Modifiers.Meta).toBe(4);
    expect(Modifiers.Shift).toBe(8);
  });
});
