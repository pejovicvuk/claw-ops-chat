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
  await session.send("Input.dispatchKeyEvent", {
    type: KEY_ACTION_TO_CDP[evt.action],
    key: evt.key,
    code: evt.code,
    text: evt.text,
    unmodifiedText: evt.text,
    modifiers: evt.modifiers ?? 0,
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
  return {
    type: KEY_ACTION_TO_CDP[evt.action],
    key: evt.key,
    code: evt.code,
    text: evt.text,
    unmodifiedText: evt.text,
    modifiers: evt.modifiers ?? 0,
  };
}

/** Modifier-mask helpers that the WS handler can use to pre-compute. */
export const Modifiers = {
  Alt: 1,
  Ctrl: 2,
  Meta: 4,
  Shift: 8,
} as const;
