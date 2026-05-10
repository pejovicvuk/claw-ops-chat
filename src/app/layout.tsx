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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
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
          SVG filter referenced by the `.lg-filter` layer of the liquid-
          glass pill (composer + scroll-to-bottom button). Stays mounted
          for the lifetime of the document so `filter: url(#lg-dist)` is
          always resolvable. Hidden via `display: none` on the <svg>; the
          <filter> child still works because filters are referenced, not
          rendered.
        */}
        <svg
          aria-hidden="true"
          style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
        >
          <defs>
            <filter id="lg-dist" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.008 0.008"
                numOctaves={2}
                seed={92}
                result="noise"
              />
              <feGaussianBlur in="noise" stdDeviation={2} result="blurred" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="blurred"
                scale={18}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
            {/*
              Goo filter referenced by the .thinking-loader SVG. The big
              alpha multiplier in the colour-matrix is the trick: it
              maps a soft Gaussian halo into a hard binary edge, so two
              nearby circles fuse into one organic blob. Pulled from the
              L02 "Liquid Metal" recipe in the loader sampler the user
              shared.
            */}
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
