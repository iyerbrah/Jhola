import { describe, expect, it } from "vitest";
import catalog from "@/data/catalog.json";
import { CatalogSchema, packLabel } from "@/lib/schema";

describe("catalog.json", () => {
  const products = CatalogSchema.parse(catalog);

  it("every record passes the schema", () => {
    expect(products.length).toBeGreaterThan(300);
  });

  it("ids are unique", () => {
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
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
