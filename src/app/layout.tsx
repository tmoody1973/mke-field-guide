import type { Metadata } from "next";
import localFont from "next/font/local";
import { Caveat } from "next/font/google";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";
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
  title: SITE_NAME,
  description: SITE_TAGLINE,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sidewalkBlock.variable} ${aktivGrotesk.variable} ${caveat.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
