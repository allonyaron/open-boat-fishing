import type { Metadata } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { PostHogProvider } from "@/components/PostHogProvider";

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

export async function generateMetadata(): Promise<Metadata> {
  const [operator] = await db.select({ name: operators.name }).from(operators).limit(1);
  const name = operator?.name ?? "Fishing Charter";
  return {
    title: name,
    description: `Book your fishing trip with ${name}`,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${plusJakarta.variable} ${manrope.variable}`}>
      <body className="font-jakarta">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
