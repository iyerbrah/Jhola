/**
 * Checks the WCAG AA contrast of every text/background pair the UI uses.
 * Normal text needs 4.5:1; large text (24px+, or 19px+ bold) needs 3:1.
 *
 * Run: npx tsx scripts/check-contrast.ts
 */
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const color = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!m) throw new Error(`No --color-${name} in globals.css`);
  return m[1];
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The colour you get when `top` sits over `base` at the given opacity. */
const mix = (base: string, top: string, alpha: number) =>
  "#" + rgb(base).map((b, i) => Math.round(b * (1 - alpha) + rgb(top)[i] * alpha).toString(16).padStart(2, "0")).join("");

// The hero's brightest spot: the marigold glow (38%) over indigo.
const glow = mix(color("ink"), color("marigold"), 0.38);

// [text, background, where it's used, large text?]
const PAIRS: [string, string, string, boolean?][] = [
  [color("ink"), color("chalk"), "body text on the page"],
  [color("ink"), color("paper"), "text on cards"],
  [color("ink-soft"), color("chalk"), "secondary text on the page"],
  [color("ink-soft"), color("paper"), "secondary text on cards"],
  [color("on-ink"), color("ink"), "hero text, dark buttons"],
  [color("on-ink"), color("ink-deep"), "hero text, darkest corner"],
  [color("on-ink-soft"), color("ink"), "hero subcopy"],
  [color("on-ink-soft"), color("ink-deep"), "hero subcopy, darkest corner"],
  [color("on-ink"), glow, "hero headline over the marigold glow", true],
  [color("ink"), color("marigold"), "Place order button"],
  [color("leaf"), color("paper"), "cart totals on cards"],
  [color("leaf"), color("leaf-soft"), "OK badge (history)"],
  [color("marigold-text"), color("marigold-soft"), "Partial badge (history)"],
  [color("ink-soft"), color("mist"), "No carts badge (history)"],
  [color("chilli"), color("chilli-soft"), "error box"],
  [color("ink"), color("chilli-soft"), "error box text"],
];

let failed = 0;
for (const [fg, bg, where, large] of PAIRS) {
  const r = ratio(fg, bg);
  const need = large ? 3 : 4.5;
  const ok = r >= need;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${r.toFixed(2)}:1 (needs ${need}) ${fg} on ${bg}  ${where}`);
}
if (failed) {
  console.error(`${failed} pair(s) fail WCAG AA`);
  process.exit(1);
}
console.log("All pairs pass WCAG AA");
