import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { SiteNav } from "@/src/components/SiteNav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ThoughtForge",
    template: "%s | ThoughtForge",
  },
  description:
    "Ten AI advisors argue a datacenter question in the open and give one decision-ready ruling. Datacenter insights and ecosystems, by Faraday Intelligence.",
  metadataBase: new URL("https://faraday-thoughtforge.com"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <SiteNav />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line bg-muted">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-muted sm:px-6">
            <span>ThoughtForge · Faraday Intelligence</span>
            <span className="font-mono text-xs tracking-[0.08em]">DATACENTER INSIGHTS &amp; ECOSYSTEMS</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
