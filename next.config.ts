import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const apiOrigin = (process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:8080").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/chat",
  reactStrictMode: true,
  poweredByHeader: false,
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
            `connect-src 'self' ws: wss: ${apiOrigin}`,
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
