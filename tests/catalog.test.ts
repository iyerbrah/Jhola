import { describe, expect, it } from "vitest";
import catalog from "@/data/catalog.json";
import { CatalogSchema, CONTAINS, DIET_TAGS, isFood, LABELS, packLabel } from "@/lib/schema";

describe("catalog.json", () => {
  const products = CatalogSchema.parse(catalog);

  it("every record passes the schema", () => {
    expect(products.length).toBeGreaterThan(300);
  });

  it("ids are unique", () => {
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
  });

  it("is groceries: food, plus household, cleaning, personal care, baby and pet essentials", () => {
    expect(products.length).toBeGreaterThan(3000);
    expect(products.filter(isFood).length / products.length).toBeGreaterThan(0.6);
  });

  it("uses only the fixed tag and contains words, and diets only on food", () => {
    const tags = new Set<string>([...DIET_TAGS, ...LABELS]);
    expect(products.filter((p) => p.tags.some((t) => !tags.has(t))).map((p) => p.id)).toEqual([]);
    expect(products.filter((p) => (p.contains ?? []).some((c) => !(CONTAINS as readonly string[]).includes(c))).map((p) => p.id)).toEqual([]);
    expect(products.filter((p) => !isFood(p) && (p.tags.some((t) => (DIET_TAGS as readonly string[]).includes(t)) || p.contains?.length)).map((p) => p.id)).toEqual([]);
  });

  it("tags diets honestly: no meat or eggs as veg, no onion or garlic as Jain, no dairy as vegan", () => {
    const named = (re: RegExp) => products.filter((p) => re.test(p.name));
    const meat = named(/\b(chicken|mutton|fish|prawns?|eggs?)\b/i).filter((p) => !/masala|seasoning|eggless/i.test(p.name));
    expect(meat.filter((p) => p.tags.includes("veg")).map((p) => p.name)).toEqual([]);
    expect(named(/\b(onion|garlic|potato|aloo)\b/i).filter((p) => p.tags.includes("jain")).map((p) => p.name)).toEqual([]);
    expect(products.filter((p) => p.tags.includes("vegan") && p.contains?.some((c) => c === "dairy" || c === "egg")).map((p) => p.name)).toEqual([]);
  });

  it("gives every kind a real choice: at least 3 in stock", () => {
    const inStock = new Map<string, number>();
    for (const p of products) inStock.set(p.sub_category, (inStock.get(p.sub_category) ?? 0) + Number(p.in_stock));
    expect([...inStock].filter(([, n]) => n < 3)).toEqual([]);
  });

  it("about 5% or fewer are out of stock", () => {
    const share = products.filter((p) => !p.in_stock).length / products.length;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.08);
  });
});

describe("packLabel", () => {
  it("formats sizes", () => {
    expect(packLabel({ pack_size: 200, unit: "g" })).toBe("200 g");
    expect(packLabel({ pack_size: 1000, unit: "g" })).toBe("1 kg");
    expect(packLabel({ pack_size: 1500, unit: "ml" })).toBe("1.5 L");
    expect(packLabel({ pack_size: 12, unit: "pcs" })).toBe("12 pcs");
  });
});
