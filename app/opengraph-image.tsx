import { ImageResponse } from "next/og";

// The link-preview card (1200x630) shown when the site is shared on LinkedIn, Slack, WhatsApp or email.
export const alt = "Jhola: type one line, get three ready-to-order grocery carts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1f2a5a";
const DEEP = "#121a3f";
const CHALK = "#f6f7f4";
const SOFT = "#b9c1e6";
const MARIGOLD = "#f0a202";
const LEAF = "#2f9a5c";

const CARTS = [
  { name: "Budget", total: "₹349", tier: LEAF },
  { name: "Classic", total: "₹490", tier: MARIGOLD },
  { name: "Premium", total: "₹762", tier: CHALK },
];

/** Fetch a Google Font as TTF for just the characters we draw. Returns null if offline. */
async function googleFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

const HEADLINE = "One line in. Three ready carts out.";
const SUBLINE = "“Paneer butter masala for 4” → three priced carts from 1,000+ real Indian grocery products.";

export default async function OpengraphImage() {
  const body = CARTS.map((c) => c.name + c.total).join("") + SUBLINE + "0123456789,+";
  const [display, sans, sansBold] = await Promise.all([
    googleFont("Yatra+One", 400, "Jhola" + HEADLINE),
    googleFont("Mukta", 500, body),
    googleFont("Mukta", 700, body),
  ]);
  const fonts = [
    display && { name: "Yatra One", data: display, weight: 400 as const },
    sans && { name: "Mukta", data: sans, weight: 500 as const },
    sansBold && { name: "Mukta", data: sansBold, weight: 700 as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 }[];
  // Without Mukta the default font has no ₹ sign, so fall back to "Rs".
  const money = (t: string) => (sans ? t : t.replace("₹", "Rs "));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          color: CHALK,
          fontFamily: sans ? "Mukta" : undefined,
          background: `radial-gradient(circle at 92% 6%, rgba(240,162,2,0.45), transparent 45%), linear-gradient(160deg, ${INK}, ${DEEP})`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: CHALK, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 30, height: 18, borderTopLeftRadius: 15, borderTopRightRadius: 15, border: `5px solid ${MARIGOLD}`, borderBottom: "none" }} />
          </div>
          <div style={{ fontSize: 48, fontFamily: display ? "Yatra One" : undefined }}>Jhola</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 80, lineHeight: 1.05, maxWidth: 980, fontFamily: display ? "Yatra One" : undefined, fontWeight: display ? 400 : 800 }}>{HEADLINE}</div>
          <div style={{ fontSize: 32, color: SOFT, maxWidth: 940 }}>{SUBLINE}</div>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          {CARTS.map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 26px",
                borderRadius: 999,
                background: "rgba(246,247,244,0.08)",
                border: `2px solid ${c.tier}`,
                fontSize: 30,
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: 7, background: c.tier }} />
              <span>{c.name}</span>
              <span style={{ fontWeight: 700 }}>{money(c.total)}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
