import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_BINDING_NAME,
  MAX_CLIPBOARD_BYTES,
  buildInjectedClipboardScript,
  validateClipboardPayload,
} from "../clipboard-bridge";

describe("validateClipboardPayload", () => {
  it("rejects non-string inputs", () => {
    expect(validateClipboardPayload(123)).toEqual({ ok: false, reason: "wrong_type" });
    expect(validateClipboardPayload(null)).toEqual({ ok: false, reason: "wrong_type" });
    expect(validateClipboardPayload(undefined)).toEqual({ ok: false, reason: "wrong_type" });
    expect(validateClipboardPayload({})).toEqual({ ok: false, reason: "wrong_type" });
    expect(validateClipboardPayload(["abc"])).toEqual({ ok: false, reason: "wrong_type" });
  });

  it("rejects empty strings", () => {
    expect(validateClipboardPayload("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects strings whose UTF-8 byte length exceeds the cap", () => {
    const big = "a".repeat(MAX_CLIPBOARD_BYTES + 1);
    expect(validateClipboardPayload(big)).toEqual({ ok: false, reason: "too_large" });
  });

  it("counts UTF-8 bytes — char count alone can't sneak past the cap", () => {
    // 4 bytes per emoji; pick a count whose char length is comfortably
    // under MAX_CLIPBOARD_BYTES but whose UTF-8 byte length is over.
    const emojiCount = Math.ceil(MAX_CLIPBOARD_BYTES / 4) + 1;
    const big = "🎉".repeat(emojiCount);
    expect(big.length).toBeLessThan(MAX_CLIPBOARD_BYTES);
    expect(validateClipboardPayload(big)).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a normal short string", () => {
    expect(validateClipboardPayload("hello world")).toEqual({
      ok: true,
      text: "hello world",
    });
  });

  it("accepts a string exactly at the byte cap", () => {
    const exact = "a".repeat(MAX_CLIPBOARD_BYTES);
    expect(validateClipboardPayload(exact)).toEqual({ ok: true, text: exact });
  });
});

describe("buildInjectedClipboardScript", () => {
  it("uses defaults for binding name and cap when called without args", () => {
    const script = buildInjectedClipboardScript();
    expect(script).toContain(JSON.stringify(CLIPBOARD_BINDING_NAME));
    expect(script).toContain(String(MAX_CLIPBOARD_BYTES));
  });

  it("respects overrides for binding name and cap", () => {
    const script = buildInjectedClipboardScript("__myBinding", 99);
    expect(script).toContain('"__myBinding"');
    expect(script).toContain("99");
    expect(script).not.toContain(JSON.stringify(CLIPBOARD_BINDING_NAME));
  });

  it("checks isTrusted to block forged copy events from page JS", () => {
    // SECURITY: this is the boundary that prevents a malicious previewed
    // page from synthesizing document.execCommand("copy") to exfiltrate
    // clipboard contents. Removing this check would be a regression.
    const script = buildInjectedClipboardScript();
    expect(script).toMatch(/isTrusted/);
  });

  it("listens for both copy and cut events", () => {
    const script = buildInjectedClipboardScript();
    expect(script).toContain('"copy"');
    expect(script).toContain('"cut"');
  });

  it("registers listeners with capture=true so page handlers can't swallow events", () => {
    const script = buildInjectedClipboardScript();
    // capture phase fires before bubble + can't be stopped by stopPropagation
    // on the target element's bubble handlers.
    expect(script).toMatch(/addEventListener\(\s*"(copy|cut)",[^,]+,\s*true\)/);
  });

  it("is wrapped in an IIFE so it leaves no globals", () => {
    const script = buildInjectedClipboardScript();
    expect(script.startsWith("(() => {")).toBe(true);
    expect(script.endsWith("})();")).toBe(true);
  });

  it("guards the binding lookup with typeof === function", () => {
    // If the binding isn't registered yet (race against page load) we
    // skip the call instead of throwing into the page.
    const script = buildInjectedClipboardScript();
    expect(script).toMatch(/typeof\s+fn\s*!==?\s*"function"/);
  });
});
