"use client";

/**
 * Full-app shimmer used while auth/data boot up. Mirrors the desktop shell
 * layout so there's no layout-shift when the real app replaces it.
 */
export function AppSkeleton() {
  return (
    <div className="grid h-dvh grid-cols-[260px_minmax(0,1fr)_40px] bg-canvas-bg">
      {/* Left sidebar skeleton */}
      <aside className="flex flex-col overflow-hidden border-r border-canvas-border">
        <div className="flex h-12 shrink-0 items-center border-b border-canvas-border px-3">
          <div className="h-4 w-24 rounded-md bg-canvas-surface-hover/60 animate-pulse" />
        </div>
        <div className="flex-1 space-y-2 px-2 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-lg bg-canvas-surface-hover/50 animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </aside>

      {/* Main column skeleton */}
      <main className="flex min-w-0 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-canvas-border px-4">
          <div className="h-4 w-40 rounded-md bg-canvas-surface-hover/50 animate-pulse" />
        </div>
        <div className="flex-1 space-y-4 px-4 py-6">
          <SkeletonBubble align="left" />
          <SkeletonBubble align="right" />
          <SkeletonBubble align="left" />
        </div>
        <div className="shrink-0 px-3 py-2">
          <div className="h-11 rounded-2xl bg-canvas-surface-hover/40 animate-pulse" />
        </div>
      </main>

      {/* Right sidebar collapsed button */}
      <aside className="border-l border-canvas-border" />
    </div>
  );
}

function SkeletonBubble({ align }: { align: "left" | "right" }) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <div className="h-16 w-2/3 max-w-[420px] rounded-2xl bg-canvas-surface-hover/40 animate-pulse" />
    </div>
  );
}
