export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, Manrope, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getOperatorRecord } from "@/lib/operator";
import { PostHogProvider } from "@/components/PostHogProvider";
import { DemoBanner } from "@/components/DemoBanner";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
