import type { Product } from "../schema";

/**
 * Words that turn a product into a different thing within the same sub_category:
 * the catalog files rice flour and rice cakes under "rice", and cumin powder next to whole cumin.
 */
const FORM_WORDS: Record<string, string> = {
  // Flour, atta and powder are all "ground": ragi powder = ragi flour, atta = whole wheat flour.
  flour: "ground",
  atta: "ground",
  powder: "ground",
  cake: "cake",
  paste: "paste",
  flake: "flake",
  noodle: "noodle",
  vermicelli: "vermicelli",
  sauce: "sauce",
  oil: "oil",
  chip: "chip",
  puff: "puff",
};

/** Form words in a product name ("Rice Cakes - Classic Plain" -> {"cake"}). */
function forms(p: Product): Set<string> {
  const words = (p.name.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => w.replace(/s$/, ""));
  // A form the category already names doesn't tell products apart: in "sauce" everything is a sauce,
  // and in flour, powder or masala categories everything is ground, named so or not ("Organic Jowar", "Deggi Mirch").
  const allGround = /flour|atta|powder|masala/.test(p.sub_category);
  return new Set(words.filter((w) => FORM_WORDS[w] && !p.sub_category.includes(w) && !(allGround && FORM_WORDS[w] === "ground")).map((w) => FORM_WORDS[w]));
}

/**
 * Can `alt` stand in for `p`? Same sub_category, same unit, and the same form
 * (plain rice never becomes rice flour; whole cumin never becomes cumin powder).
 */
export function isSameKind(p: Product, alt: Product): boolean {
  if (alt.sub_category !== p.sub_category || alt.unit !== p.unit) return false;
  const a = forms(p);
  const b = forms(alt);
  return a.size === b.size && [...a].every((f) => b.has(f));
}

/** Does a product count as the requested kind ("dark_chocolate", "dark chocolate", ...)? */
export function matchesKind(p: Product, kind: string): boolean {
  const k = kind
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (p.sub_category === k || p.tags.includes(k)) return true;
  const text = `${p.name} ${p.sub_category} ${p.tags.join(" ")}`.toLowerCase().replace(/_/g, " ");
  return text.includes(k.replace(/_/g, " ").replace(/s$/, ""));
}
