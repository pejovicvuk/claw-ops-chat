"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiChevronDown } from "react-icons/fi";
import { ratesFor } from "@/lib/model-pricing";
import type { ContextUsage } from "@/lib/use-claude-chat";
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  effortLabelFor,
  modelFamily,
  modelLabelFor,
  type EffortOption,
  type ModelOption,
} from "./composer-constants";

interface ModelThinkingPickerProps {
  /** Selected model family alias ("opus" | "sonnet" | "haiku") or null for Auto. */
  model: string | null;
  setModel: (next: string | null) => void;
  /** Selected effort level or null for Adaptive. */
  effort: string | null;
  setEffort: (next: string | null) => void;
  /** Latest context usage — used to surface the running version label
   *  (e.g. "Sonnet 4.6") on the pill when the user has Auto selected. */
  contextUsage: ContextUsage | null;
  /** When true, render an icon-only compact button (mobile). */
  compact?: boolean;
}

/**
 * Combined Model + Thinking pill, modelled on the screenshot reference
 * from Claude.ai: one button shows e.g. `Sonnet · Adaptive ▾`, and the
 * popover that opens stacks two related controls — the model family
 * list and a 6-segment Thinking selector.
 *
 * We surface family aliases (Auto / Opus / Sonnet / Haiku) instead of
 * pinning to specific versions; the running version is shown next to
 * the active row when known, so the picker still answers "what am I
 * running right now?" without forcing the user to memorise the SDK
 * default.
 */
export function ModelThinkingPicker({
  model,
  setModel,
  effort,
  setEffort,
  contextUsage,
  compact,
}: ModelThinkingPickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Pill label: prefer the running version when known (e.g. "Sonnet 4.6")
  // so the button reflects what's actually answering, not just the alias
  // the user picked. Falls back to the alias label, which covers the
  // Auto + first-render case.
  const runningRates = ratesFor(contextUsage?.model);
  const runningLabel = runningRates?.label ?? null;
  const aliasLabel = modelLabelFor(model);
  const pillModelLabel = !model ? (runningLabel ?? aliasLabel) : (runningLabel ?? aliasLabel);
  const effortLabel = effortLabelFor(effort);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Model: ${pillModelLabel}, Thinking: ${effortLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`btn-press flex items-center gap-1.5 rounded-full bg-canvas-surface-hover/60 text-canvas-fg transition-colors duration-150 hover:bg-canvas-surface-hover ${
          compact ? "h-8 px-2.5 text-[12px]" : "h-8 px-3 text-[12px] font-medium"
        }`}
      >
        <span>{pillModelLabel}</span>
        <span className="text-canvas-muted">{effortLabel}</span>
        <FiChevronDown size={12} className="text-canvas-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="lg-menu animate-modal-in absolute bottom-full right-0 z-50 mb-2 w-[300px] rounded-xl p-2"
        >
          <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
            Model
          </p>
          <div className="flex flex-col">
            {MODEL_OPTIONS.map((opt) => (
              <ModelRow
                key={opt.value}
                option={opt}
                active={(model ?? "") === opt.value}
                runningHint={
                  opt.value === "" && runningLabel
                    ? runningLabel
                    : opt.value !== "" &&
                        modelFamily(contextUsage?.model) === opt.value &&
                        runningLabel
                      ? runningLabel
                      : null
                }
                onClick={() => {
                  setModel(opt.value || null);
                  setOpen(false);
                }}
              />
            ))}
          </div>

          <div className="my-2 h-px bg-canvas-border" />

          <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
            Thinking
          </p>
          <div className="flex flex-wrap gap-1 px-1 pb-1">
            {EFFORT_OPTIONS.map((opt) => (
              <EffortChip
                key={opt.value}
                option={opt}
                active={(effort ?? "") === opt.value}
                onClick={() => setEffort(opt.value || null)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ModelRowProps {
  option: ModelOption;
  active: boolean;
  runningHint: string | null;
  onClick: () => void;
}

function ModelRow({ option, active, runningHint, onClick }: ModelRowProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-150 hover:bg-canvas-surface-hover ${
        active ? "bg-canvas-surface-hover" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-canvas-fg">
          {option.label}
          {runningHint && (
            <span className="text-[11px] font-normal text-canvas-muted">· {runningHint}</span>
          )}
        </p>
        <p className="text-[11px] text-canvas-muted">{option.description}</p>
      </div>
      {active && <span className="mt-1 text-accent">✓</span>}
    </button>
  );
}

interface EffortChipProps {
  option: EffortOption;
  active: boolean;
  onClick: () => void;
}

function EffortChip({ option, active, onClick }: EffortChipProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`btn-press rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
        active
          ? "bg-accent text-white"
          : "bg-canvas-surface-hover text-canvas-fg hover:bg-canvas-border"
      }`}
    >
      {option.label}
    </button>
  );
}
