"use client";

import { useState } from "react";
import { useIsMobile } from "@/lib/use-is-mobile";

interface EmptyStateProps {
  onSuggestionClick: (text: string) => void;
}

const SUGGESTIONS: Array<{ icon: string; label: string }> = [
  { icon: "✨", label: "Explain this repo's architecture" },
  { icon: "🐛", label: "Help me debug a failing test" },
  { icon: "📝", label: "Draft a PR description from my diff" },
];

/** Playful, deliberately-silly subtitles. One is picked at random on each
    fresh mount, so every new chat / refresh feels a little different. */
const FUNNY_SUBTITLES: string[] = [
  "What are we coombobuling today?",
  "Ready to discombobulate some code?",
  "Let's bamboozle some bugs.",
  "What flimflam shall we whip up?",
  "Prepare for maximum jiggery-pokery.",
  "Time to finagle something fantastic.",
  "What shenaniganry needs tending?",
  "Let's wrangle some codswallop.",
  "What hullabaloo are we solving today?",
  "Ready to gallivant through the repo?",
  "What kerfuffle can I help untangle?",
  "Time to noodle on something noodly.",
  "What nonsense shall we conjure?",
  "Let's hoodwink a few edge cases.",
];

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  const isMobile = useIsMobile();
  const greeting = greetingFor(new Date().getHours());
  // Lazy useState initializer: the random pick runs once at mount and is
  // stable across re-renders. A fresh mount (new chat / reload) picks a
  // new subtitle. useMemo would be impure per react-hooks/purity; useState
  // lazy init is the intended pattern for random initial values.
  const [subtitle] = useState(
    () => FUNNY_SUBTITLES[Math.floor(Math.random() * FUNNY_SUBTITLES.length)],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-24">
      <h1
        className={`animate-empty-in text-gradient-accent font-semibold tracking-tight ${
          isMobile ? "text-[32px]" : "text-[48px]"
        }`}
      >
        {greeting}
      </h1>
      <p
        className={`animate-empty-in mt-2 text-canvas-muted ${
          isMobile ? "text-[14px]" : "text-[18px]"
        }`}
        style={{ animationDelay: "90ms" }}
      >
        {subtitle}
      </p>
      <div className="mt-8 grid w-full max-w-xl gap-2">
        {SUGGESTIONS.map((s, idx) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onSuggestionClick(s.label)}
            className="animate-empty-in glass rounded-2xl px-4 py-3 text-left text-[14px] text-canvas-fg transition-all hover:scale-[1.01] hover:bg-canvas-surface-hover"
            style={{ animationDelay: `${180 + idx * 80}ms` }}
          >
            <span className="mr-2">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
