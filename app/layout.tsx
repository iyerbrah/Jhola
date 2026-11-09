import type { Metadata, Viewport } from "next";
import { Mukta, Yatra_One } from "next/font/google";
import "./globals.css";

const yatra = Yatra_One({ variable: "--font-yatra", weight: "400", subsets: ["latin"] });
const mukta = Mukta({ variable: "--font-mukta", weight: ["400", "500", "600", "700"], subsets: ["latin"] });

// The public address, used for link previews (og:url, og:image). Read at build time: on the server
// it comes from /opt/jhola/.env.production.local (https://jhola.ramiyer.tech).
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const DESCRIPTION =
  "Describe a dish, a meal or an occasion and get three ready-to-order carts built from 2,700+ real Indian groceries and household essentials, with quantities and totals worked out.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Jhola: three ready carts from one sentence", template: "%s · Jhola" },
  description: DESCRIPTION,
  applicationName: "Jhola",
  authors: [{ name: "Ram Iyer", url: "https://github.com/iyerbrah" }],
  // Link previews (LinkedIn, Slack, WhatsApp, email). The image comes from app/opengraph-image.tsx.
  openGraph: { type: "website", url: "/", siteName: "Jhola", title: "Jhola: three ready carts from one sentence", description: DESCRIPTION, locale: "en_IN" },
  twitter: { card: "summary_large_image", title: "Jhola: three ready carts from one sentence", description: DESCRIPTION },
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
