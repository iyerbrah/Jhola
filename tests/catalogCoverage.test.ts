import { describe, expect, it } from "vitest";
import requestsJson from "@/evals/coverage/requests.json";
import { catalog } from "@/lib/catalog";
import type { Product } from "@/lib/schema";
import { checkRequests, coveredShare, kindDepth, referenceCarts, unknownKinds, type CoverageRequest } from "@/scripts/catalog/coverage";

const requests = requestsJson.requests as CoverageRequest[];

describe("the grocery catalogue covers what shoppers ask for", () => {
  it("names only real kinds in the requests", () => {
    expect(unknownKinds(catalog, requests)).toEqual([]);
  });

  it("gives every kind a real choice", () => {
    expect(kindDepth(catalog)).toEqual([]);
  });

  it("covers at least 95% of the requests, across every group", () => {
    const results = checkRequests(catalog, requests);
    expect(new Set(requests.map((r) => r.group)).size).toBeGreaterThanOrEqual(20);
    expect(requests.length).toBeGreaterThanOrEqual(120);
    expect(results.filter((r) => r.missing.length).map((r) => `${r.request.request}: ${r.missing.join(", ")}`)).toEqual([]);
    expect(coveredShare(results)).toBeGreaterThanOrEqual(0.95);
  });
});

describe("reference carts, built and checked in code with no model", () => {
  it("pass review for every request, with every preference the store can meet met", () => {
    const bad = referenceCarts(catalog, requests).filter((r) => r.problems.length);
    expect(bad.map((r) => `${r.request.request}: ${r.problems.join("; ")}`)).toEqual([]);
  });
});

describe("the coverage checks", () => {
  const p = (o: Partial<Product>): Product => ({ id: "p1", name: "Milk", brand: "Amul", category: "dairy", sub_category: "milk", pack_size: 500, unit: "ml", price: 28, in_stock: true, tags: ["veg"], contains: ["dairy"], ...o });

  it("respects a request's diet and exclusions, like the solver", () => {
    const products = [p({}), p({ id: "p2", name: "Soy Milk", sub_category: "plant_milk", tags: ["veg", "vegan"], contains: [] })];
    const [vegan, noDairy, any] = checkRequests(products, [
      { group: "g", request: "vegan", diet: "vegan", kinds: ["milk", "plant_milk"] },
      { group: "g", request: "no dairy", exclude: ["dairy"], kinds: ["milk|plant_milk"] },
      { group: "g", request: "any", kinds: ["milk"] },
    ]);
    expect(vegan.missing).toEqual(["milk"]);
    expect(noDairy.missing).toEqual([]);
    expect(any.missing).toEqual([]);
  });

  it("asks staples for more choice than other kinds", () => {
    const three = [p({}), p({ id: "p2", brand: "Nandini" }), p({ id: "p3", brand: "Heritage", pack_size: 1000 })];
    expect(kindDepth(three)).toEqual([{ kind: "milk", in_stock: 3, brands: 3, sizes: 2, needs: "6 in stock, 2 brands, 2 sizes" }]);
    expect(kindDepth(three.map((x) => ({ ...x, sub_category: "condensed_milk" })))).toEqual([]);
  });
});
