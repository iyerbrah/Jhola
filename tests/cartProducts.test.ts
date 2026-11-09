import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/catalog";
import { kindsForCart, PER_KIND, productsForCart } from "@/lib/cartProducts";
import { buildInstructions, kindIndex, productLines } from "@/lib/prompt";
import type { Plan, PlanVariant, Product } from "@/lib/schema";
import { products } from "./fixtures";

const plan = (over: Partial<Plan> = {}): Plan => ({
  status: "ok",
  message: "",
  assumptions: [],
  suggestions: [],
  constraints: { budget_inr: null, item_count: null, item_kind: null },
  must_include: [],
  variants: [],
  ...over,
});
const variant = (shopping_list: string, kinds: string[]): PlanVariant => ({ name: "Classic", reason: "", shopping_list, kinds });

describe("kindsForCart", () => {
  it("takes the plan's kinds, and maps a near miss to the closest kind", async () => {
    // "gravy" isn't a kind: the search finds Ready Gravy, a ready_meal.
    expect(await kindsForCart(variant("", ["paneer", "Tomato", "gravy", "unicorn"]), plan(), products)).toEqual(["paneer", "tomato", "ready_meal"]);
  });

  it("adds the named ingredient's kind and the shopping list's kinds the plan left out", async () => {
    const kinds = await kindsForCart(variant("paneer 400 g; fresh cream 200 ml; salt (optional)", ["tomato"]), plan({ must_include: ["paneer"] }), products);
    expect(kinds).toEqual(["tomato", "paneer", "cream", "salt"]);
  });
});

describe("productsForCart", () => {
  it("shows in-stock products of those kinds only", async () => {
    const shown = await productsForCart(variant("paneer 400 g", ["paneer"]), plan(), products);
    expect([...shown.keys()]).toEqual(["paneer"]);
    // Old Paneer (p009) is out of stock. Cheapest per gram first: ₹0.36, ₹0.40 and ₹0.475 a gram.
    expect(shown.get("paneer")!.map((p) => p.id)).toEqual(["p010", "p011", "p001"]);
  });

  it("spreads a big kind from cheapest to priciest", async () => {
    const many: Product[] = Array.from({ length: 40 }, (_, i) => ({ ...products[0], id: `p${500 + i}`, name: `Paneer ${i}`, price: 50 + i }));
    const shown = (await productsForCart(variant("paneer", ["paneer"]), plan(), many)).get("paneer")!;
    expect(shown).toHaveLength(PER_KIND);
    expect(shown[0].price).toBe(50);
    expect(shown.at(-1)!.price).toBe(89);
  });
});

describe("the two-step prompt on the real catalog", () => {
  it("indexes every in-stock kind once", () => {
    const kinds = new Set(catalog.filter((p) => p.in_stock).map((p) => p.sub_category));
    expect(kindIndex(catalog).split("\n")).toHaveLength(kinds.size);
    expect(kindIndex(catalog)).toMatch(/^paneer \(dairy\): \d+, ₹\d+-\d+; e\.g\. /m);
  });

  it("keeps the fixed prompt and a cart's products small", async () => {
    // The whole catalog was about 200,000 characters; the kinds index is a small fraction of that.
    expect(buildInstructions(catalog).length).toBeLessThan(40_000);
    const pbm = variant("paneer 400 g; tomato 500 g; onion 300 g; fresh cream 200 ml; butter 50 g; ginger-garlic paste; kasuri methi; salt (optional)", ["paneer", "tomato", "onion", "cream", "butter", "ginger_garlic_paste", "kasuri_methi", "salt"]);
    const shown = await productsForCart(pbm, plan({ must_include: ["paneer"] }), catalog);
    const lines = productLines(shown);
    expect(lines).toContain("## paneer");
    expect(lines.length).toBeLessThan(15_000);
  });

  it("finds household kinds from a household shopping list", async () => {
    const kinds = await kindsForCart(variant("floor cleaner 1 L; dishwash liquid; toilet cleaner; detergent powder 1 kg", []), plan(), catalog);
    expect(kinds).toEqual(expect.arrayContaining(["floor_cleaner", "dishwash", "toilet_cleaner", "detergent"]));
  });
});
