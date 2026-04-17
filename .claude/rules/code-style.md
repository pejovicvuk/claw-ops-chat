# Code Style Rules

## TypeScript

- Always use strict TypeScript. Never use `any` — use `unknown` and narrow.
- Import order: node builtins, external packages, `@/*` aliases, relative.
- Destructure props in function signature.
- Use `satisfies` operator for type-safe object literals when helpful.
- Explicit return types on exported functions.

## React Components

- One component per file. File name matches component name in kebab-case.
- Always memoize callbacks with `useCallback` when passed to child components.
- Prefer composition over conditional rendering sprawl.
- Keep components under 200 lines. Extract sub-components when larger.
- Use `"use client"` directive only on client components (state, effects, browser APIs).

## CSS / Tailwind

- Tailwind v4 utility classes only. No inline styles unless dynamic values required.
- Use CSS custom properties from `globals.css` (`--accent`, `--canvas-bg`, etc.).
- Mobile-first responsive: base styles for mobile, then `sm:`/`md:`/`lg:` for larger.
