import type { Metadata } from "next";
import localFont from "next/font/local";
import { Caveat } from "next/font/google";
import { Marquee } from "@/components/marquee";
import { MiniPlayer } from "@/components/mini-player";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import "./globals.css";

const sidewalkBlock = localFont({
  src: "../fonts/SidewalkBlock.otf",
  variable: "--font-head",
  display: "swap",
});

const aktivGrotesk = localFont({
  src: [
    { path: "../fonts/AktivGrotesk-Regular.otf", weight: "400", style: "normal" },
    { path: "../fonts/AktivGrotesk-Medium.otf", weight: "500", style: "normal" },
    { path: "../fonts/AktivGrotesk-Bold.otf", weight: "700", style: "normal" },
    { path: "../fonts/AktivGrotesk-XBold.otf", weight: "800", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-accent",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  openGraph: { siteName: SITE_NAME, type: "website" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sidewalkBlock.variable} ${aktivGrotesk.variable} ${caveat.variable} flex min-h-screen flex-col bg-cream pb-[76px] antialiased`}>
        <Marquee text="YOUR FIELD GUIDE TO MILWAUKEE EVENTS /// POWERED BY RADIO MILWAUKEE /// 88NINE + HYFIN /// FIND YOUR NIGHT" />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <MiniPlayer />
      </body>
    </html>
  );
}
