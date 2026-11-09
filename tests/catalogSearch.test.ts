import { describe, expect, it } from "vitest";
import { createMemorySearch, MAX_LIMIT } from "@/lib/agent/search";
import { catalog } from "@/lib/catalog";
import type { Product } from "@/lib/schema";

const base: Pick<Product, "unit" | "in_stock" | "brand" | "pack_size"> = { unit: "g", in_stock: true, brand: "Fresho", pack_size: 200 };
const products: Product[] = [
  { ...base, id: "p001", name: "Fresh Paneer", category: "dairy", sub_category: "paneer", price: 95, tags: ["veg", "jain"] },
  { ...base, id: "p002", name: "Malai Paneer", category: "dairy", sub_category: "paneer", price: 72, tags: ["veg", "jain"] },
  { ...base, id: "p003", name: "Paneer Masala", category: "masalas_spices", sub_category: "paneer_masala", price: 25, tags: ["veg", "vegan"] },
  { ...base, id: "p004", name: "Old Paneer", category: "dairy", sub_category: "paneer", price: 60, in_stock: false, tags: ["veg"] },
  { ...base, id: "p005", name: "Chicken Curry Cut", category: "eggs_meat", sub_category: "chicken", price: 210, tags: ["high_protein"] },
  { ...base, id: "p006", name: "Spinach (Palak)", category: "fruits_vegetables", sub_category: "spinach", price: 25, tags: ["veg", "vegan"] },
  { ...base, id: "p007", name: "Besan", category: "atta_rice_dal", sub_category: "besan", price: 44, tags: ["veg", "vegan", "jain"] },
  { ...base, id: "p008", name: "Tomato - Local", category: "fruits_vegetables", sub_category: "tomato", price: 9, tags: ["veg", "vegan", "jain"] },
  { ...base, id: "p009", name: "Rice - Flour", category: "atta_rice_dal", sub_category: "rice", price: 22, tags: ["veg", "vegan", "jain"] },
  { ...base, id: "p010", name: "Sona Masoori Rice", category: "atta_rice_dal", sub_category: "rice", price: 43, tags: ["veg", "vegan", "jain"] },
  { ...base, id: "p011", name: "Tofu", category: "dairy", sub_category: "paneer_tofu_cream", price: 90, tags: ["veg", "vegan", "high_protein"] },
];
const search = createMemorySearch(products);
const ids = async (q: Parameters<typeof search.search>[0]) => (await search.search(q)).map((h) => h.id);

describe("catalog search", () => {
  it("finds the product itself first, cheapest first, before related products", async () => {
    expect(await ids({ text: "paneer" })).toEqual(["p002", "p001", "p003", "p011"]);
  });

  it("hides out-of-stock products unless asked", async () => {
    expect(await ids({ text: "paneer" })).not.toContain("p004");
    expect(await ids({ text: "paneer", include_out_of_stock: true })).toContain("p004");
  });

  it("filters by diet, price and category", async () => {
    expect(await ids({ text: "paneer", diet: "vegan" })).toEqual(["p003", "p011"]);
    expect(await ids({ text: "paneer", max_price: 80 })).toEqual(["p002", "p003"]);
    expect(await ids({ text: "paneer", category: "dairy" })).toEqual(["p002", "p001", "p011"]);
    expect(await ids({ text: "chicken", diet: "veg" })).toEqual([]);
  });

  it("understands Hindi names, English phrases and plurals", async () => {
    expect((await ids({ text: "palak" }))[0]).toBe("p006");
    expect((await ids({ text: "gram flour" }))[0]).toBe("p007");
    expect((await ids({ text: "cottage cheese" }))[0]).toBe("p002");
    expect((await ids({ text: "tomatoes" }))[0]).toBe("p008");
    expect((await ids({ text: "tamatar" }))[0]).toBe("p008");
  });

  it("ranks a different form of the product lower unless the query asks for it", async () => {
    // Besan comes third: its category (atta_rice_dal) is a weak match.
    expect(await ids({ text: "rice" })).toEqual(["p010", "p009", "p007"]);
    expect((await ids({ text: "rice flour" }))[0]).toBe("p009");
  });

  it("ignores filler words and returns nothing for an empty query", async () => {
    expect(await ids({ text: "some fresh paneer please" })).toContain("p001");
    expect(await ids({ text: "please for the" })).toEqual([]);
    expect(await ids({ text: "laptop" })).toEqual([]);
  });

  it("returns at most the limit, capped at 20", async () => {
    expect(await ids({ text: "paneer", limit: 2 })).toHaveLength(2);
    const many = createMemorySearch(Array.from({ length: 30 }, (_, i) => ({ ...products[0], id: `p${100 + i}` })));
    expect(await many.search({ text: "paneer", limit: 50 })).toHaveLength(MAX_LIMIT);
  });

  it("gives the agent catalog facts only: id, name, brand, pack, price, kind, tags, stock", async () => {
    const [hit] = await search.search({ text: "besan" });
    expect(hit).toEqual({ id: "p007", name: "Besan", brand: "Fresho", pack: "200 g", price: 44, sub_category: "besan", tags: ["veg", "vegan", "jain"], in_stock: true });
  });
});

/**
 * Retrieval check on the real catalog: what a shopper or the agent would type, and the kind of
 * product that must come first. All failures are reported together, so a ranking change shows its full effect.
 */
const RETRIEVAL: [query: string, firstHitKinds: string[]][] = [
  ["paneer", ["paneer"]],
  ["cottage cheese", ["paneer"]],
  ["palak", ["spinach"]],
  ["dahi", ["curd"]],
  ["curd", ["curd"]],
  ["aloo", ["potato"]],
  ["tomatoes", ["tomato"]],
  ["onion", ["onion"]],
  ["chicken", ["chicken"]],
  ["eggs", ["eggs"]],
  ["milk", ["milk"]],
  ["butter", ["butter"]],
  ["ghee", ["ghee"]],
  ["rice", ["rice"]],
  ["basmati rice", ["basmati_rice"]],
  ["toor dal", ["toor_dal"]],
  ["gram flour", ["besan"]],
  ["maida", ["maida"]],
  ["kidney beans", ["rajma"]],
  ["ladies finger", ["okra"]],
  ["jeera", ["cumin"]],
  ["haldi", ["turmeric"]],
  ["namak", ["salt"]],
  ["chillies", ["green_chilli", "chilli_powder"]],
  ["coriander leaves", ["coriander_leaves"]],
  ["garam masala", ["garam_masala"]],
  ["biryani masala", ["biryani_masala"]],
  ["cooking oil", ["cooking_oil"]],
  ["bread", ["bread"]],
  ["pav", ["bread"]],
  ["dark chocolate", ["dark_chocolate"]],
  ["green tea", ["green_tea"]],
  ["cookies", ["bakery_biscuits_cookies", "biscuits"]],
  ["ice cream", ["ice_cream", "ice_creams"]],
  ["something for dessert", ["ice_cream", "ice_creams", "doughnuts_mousses", "dessert_mixes", "pastries_brownies", "tinned_packed_sweets"]],
  ["high protein", ["chicken", "paneer", "dals_pulses", "eggs", "moong_dal", "chana", "rajma", "urad_dal", "toor_dal", "health_drinks", "snack_bar", "roasted_seeds_nuts", "almonds", "peanuts", "fish", "prawns", "mutton", "cheese", "milk", "curd", "yogurt", "paneer_tofu_cream", "oats", "muesli", "quinoa_grains", "besan"]],
];

describe("retrieval on the real catalog", () => {
  const real = createMemorySearch(catalog);

  it("puts the right kind of product first for everyday queries", async () => {
    const misses: string[] = [];
    for (const [query, kinds] of RETRIEVAL) {
      const [first] = await real.search({ text: query });
      if (!first || !kinds.includes(first.sub_category)) misses.push(`"${query}" -> ${first ? `${first.name} [${first.sub_category}]` : "nothing"}`);
    }
    expect(misses).toEqual([]);
  });

  it("keeps filters strict on real data", async () => {
    const vegChicken = await real.search({ text: "chicken", diet: "veg", limit: 20 });
    expect(vegChicken.filter((h) => !h.tags.includes("veg"))).toEqual([]);
    expect(vegChicken.some((h) => h.sub_category === "chicken")).toBe(false);

    const cheap = await real.search({ text: "chocolate", max_price: 50, limit: 20 });
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.every((h) => h.price <= 50 && h.in_stock)).toBe(true);
  });
});
