import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-mono",
  display: "swap",
});

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Without this, Next resolves og:image against http://localhost:3000 and the
// card fails to unfurl anywhere. Set NEXT_PUBLIC_SITE_URL to the deployed origin.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://edgerun.netlify.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "edgerun — a real fly brain, alive",
  description:
    "The whole adult fly connectome — 138,639 neurons, 15 million synapses — simulated live in your browser and fed by Robinhood Chain.",
  icons: {
    icon: [
      { url: `${BASE}/favicon.ico`, sizes: "any" },
      { url: `${BASE}/icon-192.png`, type: "image/png", sizes: "192x192" },
      { url: `${BASE}/icon-512.png`, type: "image/png", sizes: "512x512" },
    ],
    apple: `${BASE}/apple-touch-icon.png`,
  },
  openGraph: {
    title: "edgerun — a real fly brain, alive",
    description: "138,639 neurons simulated live in your browser, fed by Robinhood Chain.",
    images: [{ url: `${BASE}/og.png`, width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "edgerun — a real fly brain, alive",
    description: "138,639 neurons simulated live in your browser, fed by Robinhood Chain.",
    images: [`${BASE}/og.png`],
  },
};

export const viewport = { themeColor: "#cfff04" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
