/**
 * A real answer to the home page's first example chip, shown on the home page's preview card and in
 * the link-preview image. Copied from the live site on 9 Nov 2026 (the 2,743-product catalog).
 * Update it when the catalog or its prices change.
 */
export const EXAMPLE = {
  query: "Paneer butter masala for 4",
  people: 4,
  carts: [
    { name: "Budget Paneer", total: 312 },
    { name: "Classic Curry", total: 468 },
    { name: "Premium Feast", total: 787 },
  ],
} as const;

/** A dish, a household request and a gift with a budget, so the chips show the range. Warmed by `npm run warm`. */
export const EXAMPLES = [EXAMPLE.query, "Cleaning supplies for a new flat", "Gift of 4 dark chocolates under ₹1000"];
