import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Inter is the closest free analogue to Perplexity's paid FK Grotesk —
// geometric grotesque with humanist warmth. Weights 400/500/600 cover
// body / nav (slight bold) / emphasis. `next/font` self-hosts the WOFF2,
// so the existing CSP doesn't need updating.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Claw Chat",
  description: "Claude Code Chat Interface",
  manifest: "/chat/manifest.json",
  appleWebApp: {
    capable: true,
    // `black-translucent` lets the page paint EDGE-TO-EDGE under the
    // iOS status bar — the chat scrolls beneath, and the
    // `.scroll-fade-top` overlay frosts that band so the white iOS
    // status icons stay legible against the moving content. With the
    // doubled safe-area padding now removed, this is the iOS-native
    // fullscreen treatment the Anthropic / Claude.ai apps use.
    statusBarStyle: "black-translucent",
    title: "Claw Chat",
  },
  icons: {
    icon: [
      { url: "/chat/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/chat/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/chat/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `maximumScale: 1` + `userScalable: false` suppress the iOS auto-zoom
  // on input focus when font-size < 16px. We already enforce 16px on the
  // textarea, so these are belt-and-braces.
  maximumScale: 1,
  userScalable: false,
  // Required so `env(safe-area-inset-*)` returns real values on notched
  // iPhones — without `cover` they all evaluate to 0.
  viewportFit: "cover",
  // Matches `--canvas-bg` in globals.css so the iOS PWA status-bar tint
  // blends seamlessly into the page background instead of producing a
  // visible seam between status bar and chrome on first paint.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

const runtimeApiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:8080";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__CLAWCHAT_API_ORIGIN__=${JSON.stringify(runtimeApiOrigin)};`,
          }}
        />
        {/*
          Service worker registration moved to <ServiceWorkerBoot /> in
          providers.tsx so failures surface in the settings UI instead of
          being silently swallowed.
        */}
      </head>
      <body className={`${inter.variable} antialiased`}>
        {/*
          SVG goo filter referenced by the .thinking-loader. The big
          alpha multiplier in the colour-matrix maps a soft Gaussian
          halo into a hard binary edge, so two nearby circles fuse into
          one organic blob (L02 "Liquid Metal" recipe). Stays mounted
          for the lifetime of the document so `filter: url(#thinking-goo)`
          is always resolvable. Hidden via inline style on the <svg>;
          the <filter> child still works because filters are referenced,
          not rendered.
        */}
        <svg
          aria-hidden="true"
          style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
        >
          <defs>
            <filter id="thinking-goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation={10} result="blur" />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
        </svg>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
