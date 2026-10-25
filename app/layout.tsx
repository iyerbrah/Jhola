import type { Metadata, Viewport } from "next";
import { Mukta, Yatra_One } from "next/font/google";
import "./globals.css";

const yatra = Yatra_One({ variable: "--font-yatra", weight: "400", subsets: ["latin"] });
const mukta = Mukta({ variable: "--font-mukta", weight: ["400", "500", "600", "700"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jhola: three ready carts from one sentence",
  description: "Describe a dish, a meal or an occasion and get three ready-to-order grocery carts built from real Indian grocery products.",
};

export const viewport: Viewport = {
  themeColor: "#1f2a5a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Font variables go on <html> so the theme tokens (defined on :root) can see them.
    <html lang="en" className={`${yatra.variable} ${mukta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
