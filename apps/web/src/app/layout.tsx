import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenBoat Fishing",
  description: "Book your fishing trip with OpenBoat Fishing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
