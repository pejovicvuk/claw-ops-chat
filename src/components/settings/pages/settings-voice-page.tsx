"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiAlertTriangle,
  FiCheck,
  FiKey,
  FiLoader,
  FiMic,
  FiRotateCcw,
  FiTrash2,
} from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import {
  DEFAULT_SETTINGS,
  DEFAULT_SUMMARY_PROMPT,
  LANGUAGES,
  STT_PROVIDERS,
  SUMMARY_PROVIDERS,
  type SttProvider,
  type SummaryProvider,
} from "@/lib/stt-defaults";
import { SettingsSection } from "../settings-section";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface PublicSettings {
  enabled: boolean;
  sttProvider: SttProvider;
  inputLanguage: string;
  translateToEnglish: boolean;
  summaryEnabled: boolean;
  summaryProvider: SummaryProvider;
  summaryPrompt: string;
  hasOpenaiKey: boolean;
  hasGroqKey: boolean;
  hasAnthropicKey: boolean;
}

const PROVIDER_LABEL: Record<SttProvider | SummaryProvider, string> = {
  openai: "OpenAI",
  groq: "Groq",
  anthropic: "Anthropic",
};

/**
 * Settings → Voice input. Configures the mic button in the chat composer.
 *
 * Architecture:
 * - All API keys live server-side in `~/.claude/custom-stt/settings.json`.
 *   The browser only sees `hasOpenaiKey: bool`, never the raw key.
 * - Saving a new key triggers a server-side probe to the provider; bad
 *   keys are rejected before they hit the disk.
 * - "Enable mic in chat" is the master toggle — the recorder component
 *   in `chat-input.tsx` only renders when this is true and at least one
 *   STT key is configured.
 */
export function SettingsVoicePage() {
  const [data, setData] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Local form state — kept separate from `data` so the user can edit
  // freely without round-tripping the server on every keystroke.
  const [enabled, setEnabled] = useState<boolean>(DEFAULT_SETTINGS.enabled);
  const [sttProvider, setSttProvider] = useState<SttProvider>(DEFAULT_SETTINGS.sttProvider);
  const [inputLanguage, setInputLanguage] = useState<string>(DEFAULT_SETTINGS.inputLanguage);
  const [translateToEnglish, setTranslateToEnglish] = useState<boolean>(
    DEFAULT_SETTINGS.translateToEnglish,
  );
  const [summaryEnabled, setSummaryEnabled] = useState<boolean>(DEFAULT_SETTINGS.summaryEnabled);
  const [summaryProvider, setSummaryProvider] = useState<SummaryProvider>(
    DEFAULT_SETTINGS.summaryProvider,
  );
  const [summaryPrompt, setSummaryPrompt] = useState<string>(DEFAULT_SETTINGS.summaryPrompt);

  // Keys: empty string = leave alone (placeholder hints whether saved).
  const [openaiKey, setOpenaiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/stt/settings`);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const next = (await res.json()) as PublicSettings;
      setData(next);
      setEnabled(next.enabled);
      setSttProvider(next.sttProvider);
      setInputLanguage(next.inputLanguage);
      setTranslateToEnglish(next.translateToEnglish);
      setSummaryEnabled(next.summaryEnabled);
      setSummaryProvider(next.summaryProvider);
      setSummaryPrompt(next.summaryPrompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        enabled,
        sttProvider,
        inputLanguage,
        translateToEnglish,
        summaryEnabled,
        summaryProvider,
        summaryPrompt,
      };
      // Only send key fields when the user actually typed something —
      // empty strings would clear an already-saved key, which would be
      // surprising behavior on a save click.
      if (openaiKey.trim().length > 0) body.openaiApiKey = openaiKey.trim();
      if (groqKey.trim().length > 0) body.groqApiKey = groqKey.trim();
      if (anthropicKey.trim().length > 0) body.anthropicApiKey = anthropicKey.trim();

      const res = await authFetch(`${BASE}/api/stt/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Save failed (${res.status})`);
      }
      const next = (await res.json()) as PublicSettings;
      setData(next);
      setOpenaiKey("");
      setGroqKey("");
      setAnthropicKey("");
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    enabled,
    sttProvider,
    inputLanguage,
    translateToEnglish,
    summaryEnabled,
    summaryProvider,
    summaryPrompt,
    openaiKey,
    groqKey,
    anthropicKey,
  ]);

  const clearKey = useCallback(async (field: "openaiApiKey" | "groqApiKey" | "anthropicApiKey") => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`${BASE}/api/stt/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: "" }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Clear failed (${res.status})`);
      }
      const next = (await res.json()) as PublicSettings;
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear key.");
    } finally {
      setSaving(false);
    }
  }, []);

  const dirty = useMemo(() => {
    if (!data) return false;
    return (
      enabled !== data.enabled ||
      sttProvider !== data.sttProvider ||
      inputLanguage !== data.inputLanguage ||
      translateToEnglish !== data.translateToEnglish ||
      summaryEnabled !== data.summaryEnabled ||
      summaryProvider !== data.summaryProvider ||
      summaryPrompt !== data.summaryPrompt ||
      openaiKey.trim().length > 0 ||
      groqKey.trim().length > 0 ||
      anthropicKey.trim().length > 0
    );
  }, [
    data,
    enabled,
    sttProvider,
    inputLanguage,
    translateToEnglish,
    summaryEnabled,
    summaryProvider,
    summaryPrompt,
    openaiKey,
    groqKey,
    anthropicKey,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-canvas-muted">
        <FiLoader size={14} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <SettingsSection
        title="Voice input"
        description="Show a mic button in the chat composer. Audio is sent to your chosen STT provider; the API key stays on this server."
      >
        <ToggleRow
          icon={<FiMic size={13} />}
          label="Enable mic in chat input"
          checked={enabled}
          onChange={setEnabled}
        />
      </SettingsSection>

      {/* STT provider */}
      <SettingsSection
        title="Speech-to-text provider"
        description="Where audio is sent for transcription. OpenAI Whisper-1 or Groq Whisper-large-v3."
      >
        <div className="space-y-3">
          <SelectRow
            label="Provider"
            value={sttProvider}
            onChange={(v) => setSttProvider(v as SttProvider)}
            options={STT_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
          />
          <KeyRow
            label="OpenAI API key"
            placeholder="sk-..."
            value={openaiKey}
            onChange={setOpenaiKey}
            saved={data?.hasOpenaiKey ?? false}
            onClear={() => void clearKey("openaiApiKey")}
            disabled={saving}
          />
          <KeyRow
            label="Groq API key"
            placeholder="gsk_..."
            value={groqKey}
            onChange={setGroqKey}
            saved={data?.hasGroqKey ?? false}
            onClear={() => void clearKey("groqApiKey")}
            disabled={saving}
          />
        </div>
      </SettingsSection>

      {/* Languages */}
      <SettingsSection
        title="Languages"
        description="Pick the language you'll speak. Toggle 'Translate to English' to always get an English transcript regardless of what was spoken."
      >
        <div className="space-y-3">
          <SelectRow
            label="Source language"
            value={inputLanguage}
            onChange={setInputLanguage}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
          <ToggleRow
            label="Translate to English"
            checked={translateToEnglish}
            onChange={setTranslateToEnglish}
          />
        </div>
      </SettingsSection>

      {/* Summary */}
      <SettingsSection
        title="Summary"
        description="Optionally run the transcript through an LLM to produce a structured summary. Appended below the transcript in the composer."
      >
        <div className="space-y-3">
          <ToggleRow label="Enable summary" checked={summaryEnabled} onChange={setSummaryEnabled} />
          {summaryEnabled && (
            <>
              <SelectRow
                label="Summary provider"
                value={summaryProvider}
                onChange={(v) => setSummaryProvider(v as SummaryProvider)}
                options={SUMMARY_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
              />
              {summaryProvider === "anthropic" && (
                <KeyRow
                  label="Anthropic API key"
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={setAnthropicKey}
                  saved={data?.hasAnthropicKey ?? false}
                  onClear={() => void clearKey("anthropicApiKey")}
                  disabled={saving}
                />
              )}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="stt-summary-prompt" className="text-[11px] text-canvas-muted">
                    Summary prompt
                  </label>
                  <button
                    type="button"
                    onClick={() => setSummaryPrompt(DEFAULT_SUMMARY_PROMPT)}
                    className="inline-flex items-center gap-1 text-[10px] text-canvas-muted hover:text-canvas-fg"
                  >
                    <FiRotateCcw size={10} />
                    Reset to default
                  </button>
                </div>
                <textarea
                  id="stt-summary-prompt"
                  value={summaryPrompt}
                  onChange={(e) => setSummaryPrompt(e.target.value)}
                  rows={10}
                  className="w-full resize-y rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </div>
      </SettingsSection>

      {/* Save row */}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-red-500">
          <FiAlertTriangle size={10} />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
        >
          {saving ? (
            <>
              <FiLoader size={11} className="animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <FiCheck size={11} />
              Save changes
            </>
          )}
        </button>
        {savedAt && !dirty && !saving && (
          <span className="text-[11px] text-canvas-muted">Saved.</span>
        )}
      </div>

      <p className="text-[10px] text-canvas-muted">
        Keys are stored in <code>~/.claude/custom-stt/settings.json</code> (mode 0600) on this
        server. They are never returned to the browser, sent to anywhere other than the provider you
        selected, or written to the audit log.
      </p>
    </div>
  );
}

interface ToggleRowProps {
  icon?: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ icon, label, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-canvas-bg px-3 py-2.5">
      {icon && <span className="text-canvas-muted">{icon}</span>}
      <span className="flex-1 text-[12px] text-canvas-fg">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-accent"
      />
    </label>
  );
}

interface SelectRowProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}

function SelectRow({ label, value, onChange, options }: SelectRowProps) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-canvas-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 text-[12px] text-canvas-fg focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface KeyRowProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  saved: boolean;
  onClear: () => void;
  disabled: boolean;
}

function KeyRow({ label, placeholder, value, onChange, saved, onClear, disabled }: KeyRowProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] text-canvas-muted">{label}</label>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[10px] text-green-500">
            <FiCheck size={10} />
            Saved
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={saved ? "••••••••  (replace to update)" : placeholder}
          className="min-w-0 flex-1 rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2 font-mono text-[12px] text-canvas-fg placeholder:text-canvas-muted/60 focus:border-accent focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        {saved && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            title="Remove this key"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-canvas-border text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-red-500 disabled:opacity-40"
          >
            <FiTrash2 size={12} />
          </button>
        )}
        {!saved && value.length === 0 && (
          <span className="hidden text-[11px] text-canvas-muted sm:inline-flex sm:items-center sm:gap-1">
            <FiKey size={10} />
          </span>
        )}
      </div>
    </div>
  );
}
