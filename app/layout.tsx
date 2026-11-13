import type { Metadata, Viewport } from "next";
import { Anek_Latin, Bakbak_One } from "next/font/google";
import report from "@/data/catalog/report.json";
import "./globals.css";

// Bakbak One: an Indian hand-lettered poster face, for the sign. Anek Latin (variable, with a width axis) for everything else.
const bakbak = Bakbak_One({ variable: "--font-bakbak", weight: "400", subsets: ["latin", "latin-ext"] });
const anek = Anek_Latin({ variable: "--font-anek", subsets: ["latin", "latin-ext"], axes: ["wdth"] });

// The public address, used for link previews (og:url, og:image). Read at build time: on the server
// it comes from /opt/jhola/.env.production.local (https://jhola.ramiyer.tech).
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
/** "3,300+": the catalogue size, rounded down so it stays true as products come and go. */
const CATALOG_SIZE = `${(Math.floor(report.products / 100) * 100).toLocaleString("en-IN")}+`;
const DESCRIPTION = `A grocery shopping agent you chat with: describe a dish, a meal or an occasion and get one ready cart from ${CATALOG_SIZE} real Indian grocery products, in stock, the right amounts, within budget. Then change anything by asking.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Jhola: one ready cart from one sentence", template: "%s · Jhola" },
  description: DESCRIPTION,
  applicationName: "Jhola",
  authors: [{ name: "Ram Iyer", url: "https://github.com/iyerbrah" }],
  // Link previews (LinkedIn, Slack, WhatsApp, email). The image comes from app/opengraph-image.tsx.
  openGraph: { type: "website", url: "/", siteName: "Jhola", title: "Jhola: one ready cart from one sentence", description: DESCRIPTION, locale: "en_IN" },
  twitter: { card: "summary_large_image", title: "Jhola: one ready cart from one sentence", description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#0a5a32",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Font variables go on <html> so the theme tokens (defined on :root) can see them.
    <html lang="en" className={`${bakbak.variable} ${anek.variable}`}>
      <body>{children}</body>
    </html>
  );
}
