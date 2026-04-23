"use client";

import { FiFileText } from "react-icons/fi";

export function ReportsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--canvas-surface-hover)" }}
      >
        <FiFileText size={24} className="text-canvas-muted" />
      </div>
      <h2 className="text-[16px] font-semibold text-canvas-fg">Your reports will appear here</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-canvas-muted">
        Schedule Claude to work while you sleep. Each job defines a prompt, a cron schedule, and the
        exact tools Claude may use — no permission prompts, no interruptions.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="btn-press mt-6 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
      >
        Create your first report
      </button>
    </div>
  );
}
