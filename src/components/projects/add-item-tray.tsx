"use client";

import { useCallback, useEffect, useState } from "react";
import { FiPlus, FiX } from "react-icons/fi";
import type { ItemMeta } from "@/lib/items-api";
import { useIntegrationStatus } from "@/lib/use-integration-status";
import { AddItemMenu, type AddItemKind } from "./add-item-menu";
import { ItemForm, type FormKind } from "./item-form";

interface AddItemTrayProps {
  projectSlug: string;
  onCreated: (item: ItemMeta) => void;
}

type Step = "menu" | FormKind;

/**
 * Collapsible tray that owns the Add Item flow. Closed state = a single
 * accent "+ Add item" button. Open state = a small panel with either the
 * three-row picker or the active form. Esc collapses the tray.
 */
export function AddItemTray({ projectSlug, onCreated }: AddItemTrayProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const status = useIntegrationStatus();

  const close = useCallback(() => {
    setOpen(false);
    setStep("menu");
  }, []);

  const handleCreated = useCallback(
    (item: ItemMeta) => {
      onCreated(item);
      close();
    },
    [close, onCreated],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
      >
        <FiPlus size={14} />
        Add item
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-canvas-border bg-canvas-surface p-3 shadow-sm">
      {step === "menu" ? (
        <>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-canvas-fg">Add item</h3>
            <button
              type="button"
              onClick={close}
              className="btn-press flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-bg hover:text-canvas-fg"
              aria-label="Close"
            >
              <FiX size={13} />
            </button>
          </div>
          <AddItemMenu status={status} onSelect={(k: AddItemKind) => setStep(k)} />
        </>
      ) : (
        <ItemForm
          projectSlug={projectSlug}
          kind={step}
          onCreated={handleCreated}
          onBack={() => setStep("menu")}
        />
      )}
    </div>
  );
}
