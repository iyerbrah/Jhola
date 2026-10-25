import { describe, expect, it } from "vitest";
import { markPantryOptional } from "@/lib/pantry";
import { classic, index, item } from "./fixtures";

describe("markPantryOptional", () => {
  const withSalt = { ...classic, items: [item("p001", 2), item("p005")] };

  it("marks staples like salt optional", () => {
    const res = markPantryOptional(withSalt, "paneer for 4", index);
    expect(res.items.map((i) => i.optional)).toEqual([false, true]);
  });

  it("keeps a staple required when the shopper named it", () => {
    const res = markPantryOptional(withSalt, "paneer and some salt", index);
    expect(res.items.map((i) => i.optional)).toEqual([false, false]);
  });

  it("leaves the cart alone if everything would become optional", () => {
    const onlySalt = { ...classic, items: [item("p005")] };
    expect(markPantryOptional(onlySalt, "kitchen basics", index).items[0].optional).toBe(false);
  });
});
