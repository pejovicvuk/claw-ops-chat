import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const apiOrigin = (process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:8080").replace(
  /\/+$/,
  "",
);

// Derive the chat server's own origin for tight WebSocket CSP allowlisting.
// Falls back to the chat's own default port when NEXT_PUBLIC_CHAT_ORIGIN is
// not set. Using a specific hostname avoids the broad "ws: wss:" wildcard.
const chatOrigin = (
  process.env.NEXT_PUBLIC_CHAT_ORIGIN || `http://localhost:${process.env.PORT || "3100"}`
).replace(/\/+$/, "");
let chatWsHost: string;
try {
  chatWsHost = new URL(chatOrigin).hostname;
} catch {
  chatWsHost = "localhost";
}

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/chat",
  reactStrictMode: true,
  poweredByHeader: false,
  // Native / CJS-only packages that Turbopack can't bundle into ESM chunks.
  // Listed here so Next.js leaves them as runtime `require()` calls in the
  // server bundle. dockerode → docker-modem → ssh2 → crypto.js is the
  // transitive chain that breaks the production build (PR #84 surfaced
  // it as "non-ecmascript placeable asset"). systeminformation also
  // pokes /proc + spawns child processes at module load time.
  serverExternalPackages: [
    "dockerode",
    "docker-modem",
    "ssh2",
    "cpu-features",
    "systeminformation",
  ],
  // Disable the client-side router cache so refreshes always show the latest code.
  experimental: {
    staleTimes: { dynamic: 0, static: 30 },
    optimizePackageImports: [
      "react-icons",
      "react-icons/fi",
      "react-markdown",
      "@codemirror/view",
      "@codemirror/state",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/search",
      "@codemirror/autocomplete",
    ],
  },
  headers: async () => [
    // Preview iframe override — must come BEFORE the catch-all. The chat
    // app embeds dev servers running on localhost in iframes via the
    // /chat/preview/<port>/* reverse proxy. The catch-all sets
    // `frame-ancestors 'none'` + `X-Frame-Options: DENY` which would
    // forbid even same-origin embedding. Relax just for /preview/*.
    //
    // Note: `source` matches POST-basePath (Next strips the basePath
    // before regex matching), so `/preview/:port*` matches incoming
    // `/chat/preview/<port>/...` requests.
    //
    // We deliberately keep `script-src 'self' 'unsafe-inline'` and do
    // NOT add `'unsafe-eval'` — Vite/Next/Webpack dev servers don't
    // need it, and the project security rule (.claude/rules/security.md)
    // forbids it. If a future framework requires it, add it conditionally.
    //
    // `img-src` and `media-src` are widened to `* data: blob:` because
    // dev apps load assets from arbitrary local paths during development
    // and we'd rather not chase per-app CSP failures.
    {
      source: "/preview/:port*",
      headers: [
        {
          key: "Cache-Control",
          value: "no-store",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            `connect-src 'self' ws://${chatWsHost} wss://${chatWsHost} ${apiOrigin}`,
            "img-src * data: blob:",
            "media-src * data: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self'",
          ]
            .join("; ")
            .concat(";"),
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "X-Frame-Options",
          value: "SAMEORIGIN",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
      ],
    },
    {
      source: "/(.*)",
      headers: [
        {
          key: "Cache-Control",
          value: "no-cache, no-store, must-revalidate",
        },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            `connect-src 'self' ws://${chatWsHost} wss://${chatWsHost} ${apiOrigin}`,
            "img-src 'self' data: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "worker-src 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ]
            .join("; ")
            .concat(";"),
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
      ],
    },
  ],
};

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

export default withBundleAnalyzer(nextConfig);
