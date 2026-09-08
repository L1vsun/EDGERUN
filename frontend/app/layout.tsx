import type { Metadata } from "next";
import "./globals.css";
import SiteChrome from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "edgerun — Robinhood Chain contract checker",
  description:
    "Check a Robinhood Chain contract before you touch it. Contract safety and impersonation, checked separately, reported as facts not a score.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
