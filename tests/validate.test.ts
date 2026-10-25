import { describe, expect, it } from "vitest";
import { jaccard, salvage, validate } from "@/lib/validate";
import { budget, classic, index, item, output, shortcut } from "./fixtures";

describe("validate", () => {
  it("accepts a good answer", () => {
    expect(validate(output(), index)).toEqual([]);
  });

  it("accepts cannot_fulfil with no carts", () => {
    expect(validate(output({ status: "cannot_fulfil", variants: [] }), index)).toEqual([]);
  });

  it("needs exactly 3 variants with distinct names", () => {
    expect(validate(output({ variants: [classic, budget] }), index)).toContain("Expected exactly 3 variants, got 2");
    const dupName = { ...shortcut, name: "classic" };
    expect(validate(output({ variants: [classic, budget, dupName] }), index)).toContain("Variant names must be distinct");
  });

  it("collects every item error, not just the first", () => {
    const bad = { ...shortcut, items: [item("p999"), item("p009"), item("p001", 0), item("p008", 11), item("p002", 1.5)] };
    const errors = validate(output({ variants: [classic, budget, bad] }), index);
    expect(errors).toEqual(
      expect.arrayContaining([
        "Shortcut: p999 does not exist",
        "Shortcut: p009 (Old Paneer) is out of stock",
        expect.stringContaining("p001 has qty 0"),
        expect.stringContaining("p008 has qty 11"),
        expect.stringContaining("p002 has qty 1.5"),
      ]),
    );
  });

  it("rejects a product repeated in one cart", () => {
    const dup = { ...shortcut, items: [...shortcut.items, item("p008")] };
    expect(validate(output({ variants: [classic, budget, dup] }), index)).toContain("Shortcut: p008 appears more than once");
  });

  it("checks the budget on non-optional items only", () => {
    // Classic = 2×95 + 40 + 30 + 67 = 327 (salt is optional), Budget = 371, Shortcut = 315
    const within = output({ constraints: { budget_inr: 371, item_count: null, item_kind: null } });
    expect(validate(within, index)).toEqual([]);
    const over = output({ constraints: { budget_inr: 320, item_count: null, item_kind: null } });
    const errors = validate(over, index);
    expect(errors).toContain("Classic cart is ₹327, which is ₹7 over the ₹320 budget");
    expect(errors).toContain("Budget cart is ₹371, which is ₹51 over the ₹320 budget");
    expect(errors.some((e) => e.startsWith("Shortcut"))).toBe(false);
  });

  it("checks an exact item count of a kind", () => {
    const c = { budget_inr: 1000, item_count: 4, item_kind: "dark_chocolate" };
    const four = (name: string, ids: string[]) => ({ name, reason: "", model_total_inr: 0, items: ids.map((id) => item(id)) });
    const good = output({
      constraints: c,
      variants: [four("A", ["p101", "p102", "p103", "p105"]), four("B", ["p103", "p104", "p105", "p101"]), four("C", ["p102", "p104", "p105", "p103"])],
    });
    // These overlap a lot; only check the count rule here.
    expect(validate(good, index).filter((e) => e.includes("needs exactly"))).toEqual([]);

    const wrong = output({
      constraints: c,
      variants: [four("A", ["p101", "p102", "p103"]), four("B", ["p103", "p104", "p105", "p106"]), four("C", ["p102", "p104", "p105", "p103"])],
    });
    const errors = validate(wrong, index);
    expect(errors).toContain("A cart has 3 distinct dark_chocolate (and 0 other required items); it needs exactly 4");
    expect(errors).toContain("B cart has 3 distinct dark_chocolate (and 1 other required items); it needs exactly 4");
  });

  it("matches a free-text item kind", () => {
    const c = { budget_inr: null, item_count: 1, item_kind: "dark chocolates" };
    const one = (name: string, id: string) => ({ name, reason: "", model_total_inr: 0, items: [item(id)] });
    expect(validate(output({ constraints: c, variants: [one("A", "p101"), one("B", "p103"), one("C", "p105")] }), index)).toEqual([]);
  });

  it("rejects carts that are too similar", () => {
    const copy = { ...classic, name: "Classic 2" };
    const errors = validate(output({ variants: [classic, copy, shortcut] }), index);
    expect(errors).toContain("Classic and Classic 2 are too similar (100% same products); make them genuinely different");
  });
});

describe("jaccard", () => {
  it("is overlap over union of product ids", () => {
    // classic {1,2,3,4,5}, budget {1,2,6,7} -> 2 / 7
    expect(jaccard(classic, budget)).toBeCloseTo(2 / 7);
  });
});

describe("salvage", () => {
  it("drops bad items and keeps carts that still pass", () => {
    const bad = { ...shortcut, items: [...shortcut.items, item("p999"), item("p009")] };
    const res = salvage(output({ variants: [classic, budget, bad] }), index);
    expect(res.dropped).toBe(2);
    expect(res.variants.map((v) => v.name)).toEqual(["Classic", "Budget", "Shortcut"]);
    expect(res.variants[2].items.map((i) => i.product_id)).toEqual(["p001", "p008"]);
  });

  it("removes carts that break the budget", () => {
    const res = salvage(output({ constraints: { budget_inr: 330, item_count: null, item_kind: null } }), index);
    expect(res.variants.map((v) => v.name)).toEqual(["Classic", "Shortcut"]);
  });
});
