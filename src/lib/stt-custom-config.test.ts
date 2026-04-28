import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

// Redirect HOME so the helper writes into a temp dir. The module resolves
// the settings path via `os.homedir()` at import time, so HOME must be
// set BEFORE the dynamic import.
const tmpHome = mkdtempSync(join(tmpdir(), "stt-custom-config-"));
process.env.HOME = tmpHome;
const settingsFile = join(tmpHome, ".claude", "custom-stt", "settings.json");

function writeRaw(content: string): void {
  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, content);
}

const mod = await import("./stt-custom-config");
const { saveSettings, loadSettings, loadSettingsSync, deleteSettings, toPublic } = mod;

import { DEFAULT_SETTINGS } from "./stt-defaults";
import type { SttSettings } from "./stt-custom-config";

const FULL: SttSettings = {
  enabled: true,
  sttProvider: "openai",
  inputLanguage: "sr",
  translateToEnglish: true,
  summaryEnabled: true,
  summaryProvider: "anthropic",
  summaryPrompt: "summarise plz",
  openaiApiKey: "sk-test-openai",
  groqApiKey: "gsk_test_groq",
  anthropicApiKey: "sk-ant-test",
};

beforeEach(() => {
  if (existsSync(settingsFile)) rmSync(settingsFile);
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("loadSettings", () => {
  it("returns hydrated defaults when the file does not exist", async () => {
    const s = await loadSettings();
    expect(s.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(s.sttProvider).toBe(DEFAULT_SETTINGS.sttProvider);
    expect(s.inputLanguage).toBe(DEFAULT_SETTINGS.inputLanguage);
    expect(s.translateToEnglish).toBe(DEFAULT_SETTINGS.translateToEnglish);
    expect(s.summaryEnabled).toBe(DEFAULT_SETTINGS.summaryEnabled);
    expect(s.summaryProvider).toBe(DEFAULT_SETTINGS.summaryProvider);
    expect(s.summaryPrompt).toBe(DEFAULT_SETTINGS.summaryPrompt);
    expect(s.openaiApiKey).toBeUndefined();
  });

  it("falls back to defaults when the file is corrupt", async () => {
    writeRaw("{not valid json");
    const s = await loadSettings();
    expect(s.sttProvider).toBe(DEFAULT_SETTINGS.sttProvider);
  });

  it("falls back to defaults for invalid enum values", async () => {
    writeRaw(
      JSON.stringify({ sttProvider: "bogus", summaryProvider: "nope", inputLanguage: "xx" }),
    );
    const s = await loadSettings();
    expect(s.sttProvider).toBe(DEFAULT_SETTINGS.sttProvider);
    expect(s.summaryProvider).toBe(DEFAULT_SETTINGS.summaryProvider);
    expect(s.inputLanguage).toBe(DEFAULT_SETTINGS.inputLanguage);
  });
});

describe("saveSettings + loadSettings round-trip", () => {
  it("writes and reads back every field including api keys", async () => {
    await saveSettings(FULL);
    const back = await loadSettings();
    expect(back).toEqual(FULL);
  });

  it("loadSettingsSync returns the same data", async () => {
    await saveSettings(FULL);
    expect(loadSettingsSync()).toEqual(FULL);
  });

  it("writes the file with mode 0600 on POSIX", async () => {
    await saveSettings(FULL);
    if (process.platform !== "win32") {
      const mode = statSync(settingsFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

describe("deleteSettings", () => {
  it("removes the file and is a no-op when the file is absent", async () => {
    await saveSettings(FULL);
    expect(existsSync(settingsFile)).toBe(true);
    await deleteSettings();
    expect(existsSync(settingsFile)).toBe(false);
    await expect(deleteSettings()).resolves.toBeUndefined();
  });
});

describe("toPublic", () => {
  it("redacts api keys to booleans and preserves the rest", () => {
    const pub = toPublic(FULL);
    expect(pub.hasOpenaiKey).toBe(true);
    expect(pub.hasGroqKey).toBe(true);
    expect(pub.hasAnthropicKey).toBe(true);
    expect((pub as unknown as Record<string, unknown>).openaiApiKey).toBeUndefined();
    expect(pub.inputLanguage).toBe("sr");
    expect(pub.summaryProvider).toBe("anthropic");
  });

  it("reports missing keys as false", () => {
    const pub = toPublic({ ...FULL, openaiApiKey: undefined, groqApiKey: "" });
    expect(pub.hasOpenaiKey).toBe(false);
    expect(pub.hasGroqKey).toBe(false);
    expect(pub.hasAnthropicKey).toBe(true);
  });
});
