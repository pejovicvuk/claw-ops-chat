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

  it("preserves explicit clickCount for double-clicks", () => {
    // Browser sends `e.detail = 2` for the second click of a double-
    // click within the OS double-click timing; the hook forwards that
    // as clickCount and CDP turns it into a `dblclick` DOM event.
    expect(
      _mouseToCdpPayload({ action: "down", x: 0, y: 0, button: "left", clickCount: 2 }),
    ).toMatchObject({ type: "mousePressed", clickCount: 2 });
    expect(
      _mouseToCdpPayload({ action: "up", x: 0, y: 0, button: "left", clickCount: 2 }),
    ).toMatchObject({ type: "mouseReleased", clickCount: 2 });
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

  it("supplies windowsVirtualKeyCode for non-printable keys", () => {
    // Tab: 9, Enter: 13, ArrowLeft: 37 — without the VK code these
    // silently no-op in many apps when dispatched through CDP.
    expect(_keyToCdpPayload({ action: "down", key: "Tab", code: "Tab" })).toMatchObject({
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    expect(_keyToCdpPayload({ action: "down", key: "Enter", code: "Enter" })).toMatchObject({
      windowsVirtualKeyCode: 13,
    });
    expect(_keyToCdpPayload({ action: "down", key: "ArrowLeft", code: "ArrowLeft" })).toMatchObject(
      { windowsVirtualKeyCode: 37 },
    );
    expect(_keyToCdpPayload({ action: "down", key: "Backspace", code: "Backspace" })).toMatchObject(
      { windowsVirtualKeyCode: 8 },
    );
  });

  it("does NOT set windowsVirtualKeyCode for printable keys", () => {
    // Letters/digits get the right behavior from `text` + `key`. A
    // VK there can over-specify on non-US keyboards.
    const out = _keyToCdpPayload({ action: "down", key: "a", code: "KeyA", text: "a" });
    expect(out).not.toHaveProperty("windowsVirtualKeyCode");
    const digit = _keyToCdpPayload({ action: "down", key: "5", code: "Digit5", text: "5" });
    expect(digit).not.toHaveProperty("windowsVirtualKeyCode");
  });
});
