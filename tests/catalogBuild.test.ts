import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalogJson from "@/data/catalog.json";
import ledgerJson from "@/data/catalog/ids.json";
import supplementJson from "@/data/supplement.json";
import evalSessions from "@/evals/chat/sessions.json";
import { buildCatalog, isGiftOrKit, parseCsv, parseSize, type Row, type SupplementItem } from "@/scripts/catalog/build";
import { CatalogSchema, isFood, type Product } from "@/lib/schema";

// Real BigBasket rows, picked because each one was misfiled or is a case the pipeline must handle.
const rows = parseCsv(fs.readFileSync(path.join(__dirname, "fixtures/bigbasket-sample.csv"), "utf8")) as unknown as Row[];
const build = (r: Row[] = rows, ledger: Record<string, string> | null = {}, previous: Product[] = []) => buildCatalog({ rows: r, supplement: [], ledger, previous });
const find = (catalog: Product[], name: string) => {
  const p = catalog.find((x) => x.name.startsWith(name));
  if (!p) throw new Error(`${name} isn't in the catalog`);
  return p;
};

describe("catalog pipeline: kinds", () => {
  const { catalog } = build();

  it.each([
    ["Palakkad Red Matta Boiled Rice", "atta_rice_dal", "rice"], // was spinach ("palak" inside "Palakkad")
    ["Idli Rice", "atta_rice_dal", "idli_rice"], // was a beverage ("steam" contains "tea")
    ["Chicken Seekh Kabab Malai N Cheese", "eggs_meat", "ready_to_cook_meat"], // was cheese; not a plain cut either
    ["Rice - Flour", "atta_rice_dal", "flour"], // was rice
    ["Paneer - Premium Fresh", "dairy", "paneer"],
  ])("%s is %s / %s", (name, category, kind) => {
    expect(find(catalog, name)).toMatchObject({ category, sub_category: kind });
  });

  it.each([
    ["Besan Laddoo", "ghee"],
    ["Whole Wheat Khakhra", "ghee"],
    ["Dreams Cup Cake", "butter"],
    ["Indian Wheat Cracker", "cumin"],
  ])("%s isn't filed as the ingredient in its name (%s)", (name, wrong) => {
    expect(find(catalog, name).sub_category).not.toBe(wrong);
  });

  it("files non-food under its own categories, with no diet tags", () => {
    expect(find(catalog, "Original Bathing Bar Soap")).toMatchObject({ category: "personal_care", sub_category: "soap", tags: [] });
    expect(find(catalog, "Matic Top Load Detergent Powder")).toMatchObject({ category: "cleaning_household", sub_category: "detergent", tags: [] });
    expect(find(catalog, "Dry Pet Food")).toMatchObject({ category: "pet_care", sub_category: "dog_food", tags: [] });
    expect(find(catalog, "Paneer - Premium Fresh").tags).toContain("veg");
  });

  it("drops medicine, combos and multipacks, and counts why", () => {
    const { report } = build();
    expect(catalog.some((p) => /pain relief|deodorant/i.test(p.name))).toBe(false);
    expect(report.dropped).toMatchObject({ "category not sold": 1, "multipack or combo": 2 });
  });

  it("drops gift sets, trial packs and combos, but keeps a kit that is the product itself", () => {
    for (const n of ["Lavender Try Me Personal Care Gift Set", "Mach3 Gift Pack", "Broom & Dustpan Combo - Plastic", "Pro 4 Shaving Trial Kit For Men", "Coffee Prep Gift Kit", "Teen Monthly Essential Period Kit", "Glow Up Essentials Kit"]) expect(isGiftOrKit(n), n).toBe(true);
    for (const n of ["Mini Precision Screwdriver Kit", "Makeup Brushes Kit - Trio", "Gold Radiance & Rejuvenation Facial Kit", "Lux Soft Touch Soap", "Kitchen Towel", "Kit Kat"]) expect(isGiftOrKit(n), n).toBe(false);
    const row = { ...rows[0], ProductName: "Lavender Try Me Personal Care Gift Set" } as Row;
    const { catalog, report } = build([row]);
    expect(catalog).toHaveLength(0);
    expect(report.dropped["gift set or kit"]).toBe(1);
  });

  it("parses pack sizes and rejects multipacks", () => {
    expect(parseSize("1 kg")).toEqual({ pack_size: 1000, unit: "g" });
    expect(parseSize("1.5 L")).toEqual({ pack_size: 1500, unit: "ml" });
    expect(parseSize("12 pcs")).toEqual({ pack_size: 12, unit: "pcs" });
    expect(parseSize("2x150 ml")).toBeNull();
    expect(parseSize("Combo")).toBeNull();
  });
});

describe("catalog pipeline: stable IDs", () => {
  it("a rebuild with the same rows changes nothing", () => {
    const first = build();
    const second = build(rows, first.ledger, first.catalog);
    expect(second.catalog).toEqual(first.catalog);
    expect(second.ledger).toEqual(first.ledger);
  });

  it("new rows get new IDs after the highest one; old products keep theirs", () => {
    const first = build(rows.slice(0, 10));
    const second = build(rows, first.ledger, first.catalog);
    const max = Math.max(...first.catalog.map((p) => Number(p.id.slice(1))));
    for (const p of first.catalog) expect(second.catalog.find((x) => x.id === p.id)?.name).toBe(p.name);
    const added = second.catalog.filter((p) => !first.catalog.some((x) => x.id === p.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((p) => Number(p.id.slice(1)) > max)).toBe(true);
  });

  it("a product whose row disappears stays, out of stock, so saved carts still resolve", () => {
    const first = build();
    const rice = find(first.catalog, "Idli Rice");
    const second = build(rows.filter((r) => r.ProductName !== "Idli Rice"), first.ledger, first.catalog);
    expect(second.catalog.find((p) => p.id === rice.id)).toMatchObject({ name: "Idli Rice", in_stock: false });
    expect(second.report.retired).toEqual([rice.id]);
  });

  it("stock carries over from the last build", () => {
    const first = build();
    const paneer = find(first.catalog, "Paneer - Premium Fresh");
    const previous = first.catalog.map((p) => (p.id === paneer.id ? { ...p, in_stock: false } : p));
    expect(build(rows, first.ledger, previous).catalog.find((p) => p.id === paneer.id)?.in_stock).toBe(false);
  });

  it("carries a hand-added product's description through, and gives it the next ID", () => {
    const first = build();
    const sauce: SupplementItem = { name: "Tomato Basil Pasta Sauce", brand: "Test Kitchen", category: "sauces_spreads", sub_category: "sauce", pack_size: 400, unit: "g", price: 179, description: "Slow-cooked tomatoes." };
    const { catalog } = buildCatalog({ rows, supplement: [sauce], ledger: first.ledger, previous: first.catalog });
    const max = Math.max(...first.catalog.map((p) => Number(p.id.slice(1))));
    expect(find(catalog, "Tomato Basil Pasta Sauce")).toMatchObject({ id: `p${String(max + 1).padStart(3, "0")}`, description: "Slow-cooked tomatoes.", tags: ["veg", "vegan", "jain"] });
    expect(catalog.filter((p) => p.description)).toHaveLength(1);
  });

  it("without a ledger, takes IDs from the previous catalog by brand, name and size", () => {
    const first = build();
    const renumbered = first.catalog.map((p, i) => ({ ...p, id: `p${String(500 + i).padStart(3, "0")}` }));
    const { catalog } = build(rows, null, renumbered);
    expect(catalog.map((p) => p.id).sort()).toEqual(renumbered.map((p) => p.id).sort());
  });
});

describe("the committed catalog", () => {
  const catalog = CatalogSchema.parse(catalogJson);
  const ids = new Set(catalog.map((p) => p.id));
  const ledger = ledgerJson as Record<string, string>;

  it("stocks every kind the chat eval's starting sessions plan with", () => {
    const kinds = new Set(catalog.filter((p) => p.in_stock).map((p) => p.sub_category));
    const used = Object.values(evalSessions as Record<string, { needs: { kind: string }[] }>).flatMap((s) => s.needs.map((n) => n.kind));
    expect(used.filter((k) => !kinds.has(k))).toEqual([]);
  });

  it("keeps bread for loaves: pav, bread sticks, shortbread and yeast have kinds of their own", () => {
    const bread = catalog.filter((p) => p.sub_category === "bread").map((p) => p.name);
    expect(bread.length).toBeGreaterThan(0);
    expect(bread.filter((n) => /\bpav\b|\bbuns?\b|stick|short ?bread|yeast/i.test(n))).toEqual([]);
  });

  it("matches its ID ledger one to one", () => {
    const values = Object.values(ledger);
    expect(new Set(values).size).toBe(values.length);
    expect([...ids].filter((id) => !values.includes(id))).toEqual([]);
  });

  it("has every hand-added product, under its ledger ID, as a rebuild would write it", () => {
    const supplement = supplementJson as SupplementItem[];
    const missing = supplement.filter((s) => {
      const id = ledger[`sup:${s.brand}|${s.name}|${s.pack_size}${s.unit}`];
      // No ID: a BigBasket row of the same brand, name and size won the de-duplication.
      if (!id) return !catalog.some((p) => `${p.brand}|${p.name}|${p.pack_size}${p.unit}`.toLowerCase() === `${s.brand}|${s.name}|${s.pack_size}${s.unit}`.toLowerCase());
      const p = catalog.find((x) => x.id === id);
      return !p || (Object.keys(s) as (keyof SupplementItem)[]).some((k) => p[k] !== s[k]);
    });
    expect(missing).toEqual([]);
  });

  it("has the planted demo product exactly as the pipeline builds it from the supplement", () => {
    const planted = (supplementJson as SupplementItem[]).filter((s) => s.description);
    expect(planted).toHaveLength(1);
    const committed = catalog.find((p) => p.description === planted[0].description)!;
    // Built without it in the previous catalog, so its stock is the pipeline's own pick, not carried over.
    const rebuilt = buildCatalog({ rows: [], supplement: planted, ledger, previous: catalog.filter((p) => p.id !== committed.id) }).catalog;
    expect(rebuilt.find((p) => p.id === committed.id)).toEqual(committed);
    // Its ID comes from the ledger, so a rebuild that appends products never renumbers it.
    expect(ledger[`sup:${planted[0].brand}|${planted[0].name}|${planted[0].pack_size}${planted[0].unit}`]).toBe(committed.id);
  });

  it("has no gift set, trial pack or combo in stock", () => {
    expect(catalog.filter((p) => p.in_stock && isGiftOrKit(p.name)).map((p) => p.name)).toEqual([]);
  });

  it("gives non-food no diet tags", () => {
    expect(catalog.filter((p) => !isFood(p) && p.tags.length > 0)).toEqual([]);
  });
});
