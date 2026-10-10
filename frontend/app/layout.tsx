import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";

// Three faces, three jobs. The display face is the loud one and only ever sets a headline;
// the text face is plain so the headline can be loud; mono is for addresses and nothing else.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-display",
  display: "swap",
});

const text = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-text",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-mono",
  display: "swap",
});

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Without this, Next resolves og:image against http://localhost:3000 and the card fails to
// unfurl anywhere. This is the ORIGIN only - no path. The repo path comes from BASE below and
// is already prepended to every icon and og url, so putting it in both produces
// /EDGERUN/EDGERUN/og.png and a social card that 404s.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://l1vsun.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "EDGERUN - the post says buy, the wallet says sold",
  description:
    "A browser extension that checks the token in the post you are reading: which mint it really is, who paid for its holders, and what the poster's own wallet did with it. Solana first, five EVM chains, in your browser, with no server on the path.",
  icons: {
    icon: [
      { url: `${BASE}/favicon.ico`, sizes: "any" },
      { url: `${BASE}/icon-192.png`, type: "image/png", sizes: "192x192" },
      { url: `${BASE}/icon-512.png`, type: "image/png", sizes: "512x512" },
    ],
    apple: `${BASE}/apple-touch-icon.png`,
  },
  openGraph: {
    title: "EDGERUN - the post says buy, the wallet says sold",
    description: "Which mint is really in that post, who paid for its holders, and what the poster's own wallet did with it. A browser extension for X, pump.fun and Dexscreener. No server.",
    images: [{ url: `${BASE}/og.png`, width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EDGERUN - the post says buy, the wallet says sold",
    description: "Which mint is really in that post, who paid for its holders, and what the poster's own wallet did with it. A browser extension for X, pump.fun and Dexscreener. No server.",
    images: [`${BASE}/og.png`],
  },
};

// The pink. It is the ground of the first screen, so the browser chrome on a phone continues
// it instead of capping the page with a different colour.
export const viewport = { themeColor: "#ff3d9a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`}>
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
