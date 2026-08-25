import type { Metadata, Viewport } from "next";

import { Providers } from "@/providers";
import { config } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: config.appName,
    template: `%s · ${config.appName}`,
  },
  description:
    "Consent management under the Digital Personal Data Protection Act 2023: " +
    "notices, purposes, consent artefacts and the audit trail behind them.",
  // This application handles personal data. It has no business appearing in a
  // search index, and a preview card would leak project names into link unfurls.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  applicationName: config.appName,
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Not capped: a maximum-scale of 1 stops people zooming, and someone reading a
  // privacy notice on a phone is exactly who needs to.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141821" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. Without it, a dark-mode
            user gets a white flash on every navigation. Inline and synchronous
            on purpose - a deferred script is too late to prevent the flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  try {
    var stored = localStorage.getItem('cmp-theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* private mode, blocked storage: fall back to light */ }
})();`,
          }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
