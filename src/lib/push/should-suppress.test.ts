import { describe, expect, it } from "vitest";
import { shouldSuppress, type SuppressClient } from "./should-suppress";

function client(
  id: string,
  visibilityState: SuppressClient["visibilityState"],
  focused: boolean,
): SuppressClient {
  return { id, visibilityState, focused };
}

describe("shouldSuppress", () => {
  describe("alwaysShow", () => {
    it("never suppresses, even with a focused same-chat tab", () => {
      const clients = [client("a", "visible", true)];
      const map = new Map([["a", "chat-1"]]);
      expect(shouldSuppress("alwaysShow", clients, "chat-1", map)).toBe(false);
    });
  });

  describe("with no client windows at all", () => {
    it("falls open to show the notification (PWA closed case)", () => {
      const map = new Map<string, string>();
      expect(shouldSuppress("smartChat", [], "chat-1", map)).toBe(false);
      expect(shouldSuppress("suppress", [], "chat-1", map)).toBe(false);
    });
  });

  describe("suppress mode", () => {
    it("suppresses when a window is visible AND focused", () => {
      const clients = [client("a", "visible", true)];
      expect(shouldSuppress("suppress", clients, null, new Map())).toBe(true);
    });

    it("does not suppress when the only window is visible but not focused", () => {
      const clients = [client("a", "visible", false)];
      expect(shouldSuppress("suppress", clients, null, new Map())).toBe(false);
    });

    it("does not suppress when the only window is hidden", () => {
      const clients = [client("a", "hidden", true)];
      expect(shouldSuppress("suppress", clients, null, new Map())).toBe(false);
    });
  });

  describe("smartChat mode (the default)", () => {
    it("suppresses when a visible window is on the same chat — even without OS focus", () => {
      const clients = [client("a", "visible", false)];
      const map = new Map([["a", "chat-1"]]);
      expect(shouldSuppress("smartChat", clients, "chat-1", map)).toBe(true);
    });

    it("suppresses when a visible AND focused window is on the same chat", () => {
      const clients = [client("a", "visible", true)];
      const map = new Map([["a", "chat-1"]]);
      expect(shouldSuppress("smartChat", clients, "chat-1", map)).toBe(true);
    });

    it("does NOT suppress when the visible window is on a different chat", () => {
      const clients = [client("a", "visible", true)];
      const map = new Map([["a", "chat-1"]]);
      expect(shouldSuppress("smartChat", clients, "chat-2", map)).toBe(false);
    });

    it("does NOT suppress when no client has reported its active chat yet", () => {
      const clients = [client("a", "visible", true)];
      expect(shouldSuppress("smartChat", clients, "chat-1", new Map())).toBe(false);
    });

    it("does NOT suppress when the chatId is null (cron / monitoring events)", () => {
      const clients = [client("a", "visible", true)];
      const map = new Map([["a", "chat-1"]]);
      expect(shouldSuppress("smartChat", clients, null, map)).toBe(false);
    });

    it("does NOT suppress when the only window is hidden, even if its chat matches", () => {
      const clients = [client("a", "hidden", true)];
      const map = new Map([["a", "chat-1"]]);
      expect(shouldSuppress("smartChat", clients, "chat-1", map)).toBe(false);
    });

    it("suppresses when one of multiple visible windows is on the same chat", () => {
      const clients = [
        client("a", "visible", false),
        client("b", "visible", true),
        client("c", "hidden", false),
      ];
      const map = new Map([
        ["a", "chat-other"],
        ["b", "chat-1"],
        ["c", "chat-1"],
      ]);
      expect(shouldSuppress("smartChat", clients, "chat-1", map)).toBe(true);
    });

    it("does NOT suppress when only the hidden window matches the chat", () => {
      const clients = [client("a", "visible", true), client("b", "hidden", false)];
      const map = new Map([
        ["a", "chat-other"],
        ["b", "chat-1"],
      ]);
      expect(shouldSuppress("smartChat", clients, "chat-1", map)).toBe(false);
    });
  });
});
