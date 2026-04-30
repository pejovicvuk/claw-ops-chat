import type { CDPSession, Page } from "playwright-core";

/**
 * Translate client WebSocket input events into Chrome DevTools
 * Protocol `Input.dispatch*` calls so the user's clicks / typing /
 * scrolling reach the headless Chromium tab.
 *
 * Pure on the way in — every function takes a CDP session + a
 * client-shaped payload and returns the matching CDP request.
 * Page-level operations (resize, navigate) take a Page directly.
 *
 * Modifier mask is what CDP expects:
 *   Alt = 1, Ctrl = 2, Meta = 4, Shift = 8.
 */

export interface MouseEvent {
  action: "down" | "up" | "move";
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  /** Mask of currently-held buttons for DOM compatibility — CDP wants this on `move`. */
  buttons?: number;
  clickCount?: number;
}

export interface WheelEvent {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export interface KeyEvent {
  action: "down" | "up" | "char";
  key: string;
  code: string;
  text?: string;
  modifiers?: number;
}

export interface ResizeEvent {
  width: number;
  height: number;
}

const MOUSE_ACTION_TO_CDP = {
  down: "mousePressed",
  up: "mouseReleased",
  move: "mouseMoved",
} as const satisfies Record<MouseEvent["action"], "mousePressed" | "mouseReleased" | "mouseMoved">;

const KEY_ACTION_TO_CDP = {
  down: "keyDown",
  up: "keyUp",
  char: "char",
} as const satisfies Record<KeyEvent["action"], "keyDown" | "keyUp" | "char">;

/**
 * Windows virtual-key codes for non-printable keys. CDP's
 * `Input.dispatchKeyEvent` reliably synthesizes browser key events
 * for non-printable keys ONLY when given `windowsVirtualKeyCode` —
 * `key` + `code` alone are often ignored, so without this table
 * Tab / Enter / Backspace / Arrow keys silently no-op in many apps.
 *
 * Printable keys (letters, digits, symbols) are deliberately absent;
 * CDP picks the right code from `text` / `key` for those, and
 * supplying a VK can over-specify and produce wrong characters with
 * non-US keyboards.
 *
 * Source: https://docs.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
 */
export const WIN_VK_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PrintScreen: 44,
  Insert: 45,
  Delete: 46,
  MetaLeft: 91,
  MetaRight: 92,
  ContextMenu: 93,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123,
  NumLock: 144,
  ScrollLock: 145,
};

export async function forwardMouse(session: CDPSession, evt: MouseEvent): Promise<void> {
  await session.send("Input.dispatchMouseEvent", {
    type: MOUSE_ACTION_TO_CDP[evt.action],
    x: evt.x,
    y: evt.y,
    button: evt.button ?? "none",
    buttons: evt.buttons ?? 0,
    clickCount: evt.clickCount ?? (evt.action === "down" || evt.action === "up" ? 1 : 0),
  });
}

export async function forwardWheel(session: CDPSession, evt: WheelEvent): Promise<void> {
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: evt.x,
    y: evt.y,
    deltaX: evt.deltaX,
    deltaY: evt.deltaY,
    button: "none",
    buttons: 0,
  });
}

export async function forwardKey(session: CDPSession, evt: KeyEvent): Promise<void> {
  const vk = WIN_VK_CODES[evt.code];
  await session.send("Input.dispatchKeyEvent", {
    type: KEY_ACTION_TO_CDP[evt.action],
    key: evt.key,
    code: evt.code,
    text: evt.text,
    unmodifiedText: evt.text,
    modifiers: evt.modifiers ?? 0,
    ...(vk !== undefined ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
  });
}

export async function forwardResize(page: Page, evt: ResizeEvent): Promise<void> {
  await page.setViewportSize({
    width: Math.max(200, Math.min(4096, Math.round(evt.width))),
    height: Math.max(200, Math.min(4096, Math.round(evt.height))),
  });
}

/**
 * Pure helpers — used by tests to verify event-shape translation
 * without standing up a real CDP session.
 */
export function _mouseToCdpPayload(evt: MouseEvent) {
  return {
    type: MOUSE_ACTION_TO_CDP[evt.action],
    x: evt.x,
    y: evt.y,
    button: evt.button ?? "none",
    buttons: evt.buttons ?? 0,
    clickCount: evt.clickCount ?? (evt.action === "down" || evt.action === "up" ? 1 : 0),
  };
}

export function _wheelToCdpPayload(evt: WheelEvent) {
  return {
    type: "mouseWheel",
    x: evt.x,
    y: evt.y,
    deltaX: evt.deltaX,
    deltaY: evt.deltaY,
    button: "none",
    buttons: 0,
  };
}

export function _keyToCdpPayload(evt: KeyEvent) {
  const vk = WIN_VK_CODES[evt.code];
  return {
    type: KEY_ACTION_TO_CDP[evt.action],
    key: evt.key,
    code: evt.code,
    text: evt.text,
    unmodifiedText: evt.text,
    modifiers: evt.modifiers ?? 0,
    ...(vk !== undefined ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
  };
}

/** Modifier-mask helpers that the WS handler can use to pre-compute. */
export const Modifiers = {
  Alt: 1,
  Ctrl: 2,
  Meta: 4,
  Shift: 8,
} as const;
