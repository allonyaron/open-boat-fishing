export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getOperatorRecord } from "@/lib/operator";
import { PostHogProvider } from "@/components/PostHogProvider";
import { DemoBanner } from "@/components/DemoBanner";

// Self-hosted latin-subset woff2s (see fonts/README.md for their source), so
// the build never downloads from Google Fonts.
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
  display: "swap",
});

const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-plus-jakarta",
  display: "swap",
});

const manrope = localFont({
  src: "./fonts/manrope/manrope-latin-wght-normal.woff2",
  weight: "700 800",
  variable: "--font-manrope",
  display: "swap",
});

const archivo = localFont({
  src: "./fonts/archivo/archivo-latin-wght-normal.woff2",
  weight: "400 800",
  variable: "--font-archivo",
  display: "swap",
});

const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const operator = await getOperatorRecord();
  const name = operator?.name ?? "Fishing Charter";
  return {
    title: name,
    description: `Book your fishing trip with ${name}`,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${plusJakarta.variable} ${manrope.variable} ${archivo.variable} ${ibmPlexMono.variable}`}>
      <body className="font-jakarta">
        <DemoBanner />
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
