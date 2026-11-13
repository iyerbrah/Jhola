import report from "@/data/catalog/report.json";
import { ImageResponse } from "next/og";

// The link-preview card (1200x630) shown when the site is shared on LinkedIn, Slack, WhatsApp or email.
export const alt = "Jhola: a shopping agent that turns one line into one ready cart";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The signboard's paint (app/globals.css).
const SIGN = "#0a5a32";
const SIGN_DEEP = "#07432a";
const ON_SIGN = "#ffffff";
const ON_SIGN_SOFT = "#cde6d5";
const TURMERIC = "#f5b81c";
const RANI = "#c8195a";
const RANI_BRIGHT = "#ec4d86";
const INK = "#1e2a22";

// The checklist every cart gets, as on the home page's board.
const CHECKS = ["All in stock", "Under ₹600", "Vegetarian"];

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

const HEADLINE = "One line in. One ready cart out.";
const SUBLINE = `“Pasta night for 4, vegetarian, around ₹600” → a cart from ${(Math.floor(report.products / 100) * 100).toLocaleString("en-IN")}+ real Indian grocery products, then change anything by chatting.`;

export default async function OpengraphImage() {
  const body = CHECKS.join("") + SUBLINE + "0123456789,+";
  const [sign, sans, sansBold] = await Promise.all([googleFont("Bakbak+One", 400, "Jhola₹293" + HEADLINE), googleFont("Anek+Latin", 500, body), googleFont("Anek+Latin", 700, body)]);
  const fonts = [
    sign && { name: "Bakbak One", data: sign, weight: 400 as const },
    sans && { name: "Anek Latin", data: sans, weight: 500 as const },
    sansBold && { name: "Anek Latin", data: sansBold, weight: 700 as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 }[];
  // Without Anek the default font has no ₹ sign, so fall back to "Rs".
  const money = (t: string) => (sans ? t : t.replace("₹", "Rs "));
  const painted = { fontFamily: sign ? "Bakbak One" : undefined, color: TURMERIC, textShadow: `5px 5px 0 ${RANI_BRIGHT}` };

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: SIGN, color: ON_SIGN, fontFamily: sans ? "Anek Latin" : undefined }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 72px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ ...painted, fontSize: 64, lineHeight: 1 }}>Jhola</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 26px 8px 40px",
              background: TURMERIC,
              color: INK,
              fontSize: 44,
              fontFamily: sign ? "Bakbak One" : undefined,
              borderRadius: 6,
            }}
          >
            {money("₹293")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ ...painted, fontSize: 92, lineHeight: 1, maxWidth: 1000, fontWeight: sign ? 400 : 800 }}>{HEADLINE}</div>
          <div style={{ fontSize: 31, lineHeight: 1.3, color: ON_SIGN_SOFT, maxWidth: 980 }}>{money(SUBLINE)}</div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {CHECKS.map((c) => (
            <div
              key={c}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 24px",
                borderRadius: 999,
                background: SIGN_DEEP,
                border: `2px solid ${ON_SIGN_SOFT}`,
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {/* A drawn tick: Anek has no ✓ glyph. */}
                <div style={{ width: 11, height: 20, marginTop: -6, borderRight: `4px solid ${TURMERIC}`, borderBottom: `4px solid ${TURMERIC}`, transform: "rotate(45deg)" }} />
              <span>{money(c)}</span>
            </div>
          ))}
        </div>
      </div>
      {/* The painted stripe under every Jhola sign. */}
      <div style={{ display: "flex", height: 16, background: TURMERIC }} />
      <div style={{ display: "flex", height: 10, background: RANI }} />
    </div>,
    { ...size, fonts },
  );
}
