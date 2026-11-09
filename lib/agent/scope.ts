/**
 * Which carts a turn may change, decided in code from the shopper's words.
 *
 * The rule (docs/agent-plan.md, decision 3): the cart the shopper is looking at, unless they name
 * another ("cart 3", "the premium one") or ask for all of them ("every cart", "all three").
 * The model ignored this rule when it was only an instruction, so the editing tools now refuse
 * carts outside the scope.
 */

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, first: 1, second: 2, third: 3, "1st": 1, "2nd": 2, "3rd": 3 };

/** "all three", "every cart", "both carts", "the others", "my carts": all of them. */
const ALL = [
  /\b(all|every|each|both)\s+(of\s+)?(the\s+|my\s+|these\s+)?(3\s+|three\s+)?(carts?|ones?|of them|of these)\b/,
  /\ball\s+(3|three)\b/,
  /\b(the\s+)?(others|rest|other\s+(carts?|ones?|two))\b/,
  /\bcarts\b/,
];

/** Words in this cart's name that no other cart's name has ("budget" in "Budget Biryani"). */
function distinctWords(names: string[], i: number): string[] {
  const words = (n: string) => new Set(n.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const mine = words(names[i]);
  const others = new Set(names.flatMap((n, j) => (j === i ? [] : [...words(n)])));
  return [...mine].filter((w) => !others.has(w));
}

/** Carts the message names, or "all", or none (empty set) if it names nothing. */
export function namedCarts(message: string, names: string[]): Set<number> | "all" {
  const text = message.toLowerCase();
  if (ALL.some((re) => re.test(text))) return "all";
  const found = new Set<number>();
  for (const m of text.matchAll(/\bcart\s*(?:no\.?\s*|#|number\s*)?([1-3]|one|two|three)\b/g)) found.add((NUMBER_WORDS[m[1]] ?? Number(m[1])) - 1);
  for (const m of text.matchAll(/\b(first|second|third|1st|2nd|3rd|last)\s+(cart|one)\b/g)) found.add(m[1] === "last" ? names.length - 1 : NUMBER_WORDS[m[1]] - 1);
  names.forEach((name, i) => {
    if (text.includes(name.toLowerCase())) found.add(i);
    for (const w of distinctWords(names, i)) {
      // "the premium one", "budget cart": a tier word alone ("within budget") isn't enough.
      if (new RegExp(`\\b${w}\\s+(one|cart|version|option)\\b`).test(text)) found.add(i);
    }
  });
  return new Set([...found].filter((i) => i >= 0 && i < names.length));
}

/**
 * The 0-based carts this turn may change. A message that names no cart inherits what the
 * previous message named ("make all three veg" … "now cheaper"), else it's the visible cart.
 */
export function cartsInScope(message: string, names: string[], active: number, previousMessage?: string): Set<number> {
  const all = () => new Set(names.map((_, i) => i));
  for (const text of [message, previousMessage]) {
    if (!text) continue;
    const named = namedCarts(text, names);
    if (named === "all") return all();
    if (named.size) return named;
  }
  return new Set([active]);
}
