import type { Framework } from "./types";

/**
 * Display label for a framework. Lives in its own file (separate from
 * `detect-framework.ts`) because that one imports `fs` and gets pulled
 * into route bundles; importing this from a client component
 * (`preview-window.tsx`) used to drag the whole detector — and `fs` —
 * into the browser bundle, which Turbopack then refused to compile.
 */
export function frameworkLabel(framework: Framework): string {
  switch (framework) {
    case "next":
      return "Next";
    case "vite":
      return "Vite";
    case "cra":
      return "CRA";
    case "nestjs":
      return "NestJS";
    case "astro":
      return "Astro";
    case "nuxt":
      return "Nuxt";
    case "node-script":
      return "Dev script";
    case "unknown":
      return "Unknown";
  }
}
