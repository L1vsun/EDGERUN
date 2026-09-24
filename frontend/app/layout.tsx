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
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://edgerun.live";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "EDGERUN - is that the real contract?",
  description:
    "A browser extension that checks whether the token in the post you are reading is the contract it claims to be - six chains, in your browser, with no server on the path.",
  icons: {
    icon: [
      { url: `${BASE}/favicon.ico`, sizes: "any" },
      { url: `${BASE}/icon-192.png`, type: "image/png", sizes: "192x192" },
      { url: `${BASE}/icon-512.png`, type: "image/png", sizes: "512x512" },
    ],
    apple: `${BASE}/apple-touch-icon.png`,
  },
  openGraph: {
    title: "EDGERUN - is that the real contract?",
    description: "Seven contracts use $PEPE on one chain alone. EDGERUN tells you which one you are actually looking at - across six chains, in your browser.",
    images: [{ url: `${BASE}/og.png`, width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EDGERUN - is that the real contract?",
    description: "Seven contracts use $PEPE on one chain alone. EDGERUN tells you which one you are actually looking at - across six chains, in your browser.",
    images: [`${BASE}/og.png`],
  },
};

export const viewport = { themeColor: "#cfff04" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the inline script below rewrites data-theme before hydration, which React would
    // otherwise report as a server/client mismatch
    <html lang="en" className={`${display.variable} ${mono.variable}`} data-theme="light" suppressHydrationWarning>
      <head>
        {/* Applied before first paint, so a dark-theme visitor never sees a light flash.
            Light is the default and the OS preference is deliberately not consulted: only a
            stored choice moves it, so the site looks the same to everyone until they say
            otherwise. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('edgerun.theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
