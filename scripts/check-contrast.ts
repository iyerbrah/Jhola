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
// [text, background, where it's used, large text?]
const PAIRS: [string, string, string, boolean?][] = [
  [color("ink"), color("wall"), "body text on the page"],
  [color("ink"), color("paper"), "text on the cart, sheets and tables"],
  [color("ink-soft"), color("wall"), "secondary text on the page"],
  [color("ink-soft"), color("paper"), "secondary text in the cart"],
  [color("on-sign"), color("sign"), "nav, sheet titles, green buttons, your messages"],
  [color("on-sign"), color("sign-deep"), "green buttons on hover"],
  [color("on-sign-soft"), color("sign"), "sign subcopy, nav links"],
  [color("turmeric"), color("sign"), "painted lettering on the sign", true],
  [color("ink"), color("turmeric"), "price tags, checkout button"],
  [color("ink"), color("turmeric-deep"), "checkout button on hover"],
  [color("sign"), color("paper"), "green text and secondary buttons"],
  [color("sign"), color("sign-soft"), "why tags, checks, diet chip"],
  [color("sign"), color("wall"), "suggestion ticks' notes"],
  [color("turmeric-text"), color("turmeric-soft"), "I understood, stand-ins, the list being written"],
  [color("turmeric-text"), color("paper"), "warnings on a line"],
  [color("rani"), color("paper"), "focus ring, model steps in the trace"],
  [color("rani"), color("rani-soft"), "Your pick tag"],
  [color("ink"), color("rani-soft"), "a just-changed cart line"],
  [color("ink-soft"), color("rani-soft"), "a just-changed cart line, second row"],
  [color("chilli"), color("paper"), "errors and removals"],
  [color("chilli"), color("chilli-soft"), "flagged listing, error box"],
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
