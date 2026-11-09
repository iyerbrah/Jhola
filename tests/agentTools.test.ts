import { describe, expect, it } from "vitest";
import { diffCarts } from "@/lib/agent/changes";
import { cartView, runTool, statusFor, TOOL_SPECS, type AgentState } from "@/lib/agent/tools";
import { cartTotal } from "@/lib/cartState";
import { toCartItem } from "@/lib/agent/carts";
import { biryaniCarts, deps, index, none } from "./agentFixtures";

const fresh = (): AgentState => ({ carts: biryaniCarts(), active: 0, version: 0, touched: new Set() });
const run = (state: AgentState, name: string, args: unknown) => runTool(name, JSON.stringify(args), state, deps);

describe("tool schemas", () => {
  it("are strict: every property required, nothing extra", () => {
    for (const t of TOOL_SPECS) {
      const p = t.parameters as { properties: object; required: string[]; additionalProperties: boolean };
      expect(p.additionalProperties).toBe(false);
      expect([...p.required].sort()).toEqual(Object.keys(p.properties).sort());
    }
  });
});

describe("search_catalog", () => {
  it("returns one line per in-stock product, with diet tags", async () => {
    const r = await run(fresh(), "search_catalog", { text: "paneer", diet: null, max_price: null, category: null });
    expect(r.ok).toBe(true);
    expect(r.output.split("\n")).toEqual([
      "p007 | Malai Paneer | Fresho | 200 g | ₹72 | paneer | veg,jain | in stock",
      "p001 | Fresh Paneer | Fresho | 200 g | ₹95 | paneer | veg,jain,high_protein | in stock",
    ]);
  });

  it("says when nothing matches", async () => {
    const r = await run(fresh(), "search_catalog", { text: "laptop", diet: null, max_price: null, category: null });
    expect(r.output).toContain('No in-stock products match "laptop"');
  });
});

describe("editing tools", () => {
  it("add_item adds a required line priced from the catalog and marks the cart changed", async () => {
    const s = fresh();
    const r = await run(s, "add_item", { cart: 1, product_id: "p008", qty: 1 });
    expect(r.ok).toBe(true);
    expect(s.carts[0].items.at(-1)).toMatchObject({ product_id: "p008", price: 58, qty: 1, optional: false, included: true });
    expect(cartTotal(s.carts[0])).toBe(420 + 84 + 30 + 58);
    expect([...s.touched]).toEqual([0]);
    expect(s.version).toBe(1);
    expect(r.output).toContain('Cart 1 "Budget": total ₹592');
  });

  it("refuses an out-of-stock product and offers in-stock twins", async () => {
    const s = fresh();
    const r = await run(s, "add_item", { cart: 1, product_id: "p006", qty: 1 });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("p006 (Old Paneer) is out of stock. Closest in stock:");
    expect(r.output).toContain("p007 | Malai Paneer");
    expect(s.version).toBe(0);
  });

  it("explains every other bad request without changing anything", async () => {
    const s = fresh();
    const cases: [string, unknown, string][] = [
      ["add_item", { cart: 1, product_id: "p999", qty: 1 }, "p999 isn't in the catalog. Use search_catalog"],
      ["add_item", { cart: 1, product_id: "p004", qty: 1 }, "p004 is already in cart 1 with qty 1. Use set_qty"],
      ["add_item", { cart: 1, product_id: "p001", qty: 11 }, "qty must be a whole number from 1 to 10"],
      ["add_item", { cart: 4, product_id: "p001", qty: 1 }, "there are only carts 1 to 3"],
      ["remove_item", { cart: 1, product_id: "p001" }, "p001 isn't in cart 1"],
      ["swap_item", { cart: 1, product_id: "p002", new_product_id: "p004" }, "p004 is already in cart 1"],
      ["set_qty", { cart: 1, product_id: "p001", qty: 2 }, "Use add_item to add it"],
      ["add_item", { cart: 1, product_id: "p001" }, "bad arguments for add_item: qty"],
      ["fly_away", {}, "there is no tool called fly_away"],
    ];
    for (const [name, args, message] of cases) {
      const r = await run(s, name, args);
      expect(r.ok, name).toBe(false);
      expect(r.output).toContain(message);
    }
    expect((await runTool("add_item", "{not json", s, deps)).output).toContain("weren't valid JSON");
    expect(s.version).toBe(0);
    expect(s.carts).toEqual(biryaniCarts());
  });

  it("swap_item keeps the quantity and the optional flag; set_qty and remove_item edit in place", async () => {
    const s = fresh();
    await run(s, "swap_item", { cart: 1, product_id: "p002", new_product_id: "p001" });
    expect(s.carts[0].items[0]).toMatchObject({ product_id: "p001", name: "Fresh Paneer", qty: 2, line_total: 190 });
    await run(s, "set_qty", { cart: 1, product_id: "p001", qty: 4 });
    expect(s.carts[0].items[0]).toMatchObject({ qty: 4, line_total: 380 });
    await run(s, "remove_item", { cart: 1, product_id: "p003" });
    expect(s.carts[0].items.map((i) => i.product_id)).toEqual(["p001", "p004", "p005"]);
    expect(s.carts[0].requirements.must_include).toEqual(["chicken"]);
  });
});

describe("set_requirements", () => {
  it("sets a diet, drops a named ingredient, and lists what now needs fixing", async () => {
    const s = fresh();
    const r = await run(s, "set_requirements", { cart: 1, diet: "veg", budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: "paneer" }] });
    expect(s.carts[0].requirements).toMatchObject({ diet: "veg", must_include: ["paneer"] });
    expect(r.output).toContain("To fix now:");
    expect(r.output).toContain("- Budget: p002 (Chicken Curry Cut) isn't vegetarian");
    expect(r.output).toContain("- Budget has no paneer, which the shopper asked for");
    expect([...s.touched]).toEqual([0]);
  });

  it("clears a diet with \"any\" and a budget with 0, and leaves nulls alone", async () => {
    const s = fresh();
    await run(s, "set_requirements", { cart: 2, diet: "vegan", budget_inr: 500, drop_must_include: [] });
    expect(s.carts[1].requirements).toMatchObject({ diet: "vegan", budget_inr: 500, must_include: ["chicken"] });
    await run(s, "set_requirements", { cart: 2, diet: null, budget_inr: null, drop_must_include: [] });
    expect(s.carts[1].requirements).toMatchObject({ diet: "vegan", budget_inr: 500 });
    await run(s, "set_requirements", { cart: 2, diet: "any", budget_inr: 0, drop_must_include: [] });
    expect(s.carts[1].requirements).toMatchObject({ diet: null, budget_inr: null });
  });

  it("makes a replacement the dish's new named ingredient, which finish then checks", async () => {
    const s = fresh();
    await run(s, "set_requirements", { cart: 1, diet: "veg", budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: "paneer" }] });
    await run(s, "remove_item", { cart: 1, product_id: "p002" });
    const refused = await run(s, "finish", { reply: "Made it vegetarian." });
    expect(refused.output).toContain("Budget has no paneer, which the shopper asked for");
    await run(s, "add_item", { cart: 1, product_id: "p001", qty: 4 });
    expect((await run(s, "finish", { reply: "Swapped the chicken for paneer." })).finished).toBeTruthy();
  });

  it("refuses a replacement the catalog doesn't stock (with the diet), and allows none when the shopper has it", async () => {
    const s = fresh();
    const bad = await run(s, "set_requirements", { cart: 1, diet: "vegan", budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: "paneer" }] });
    expect(bad.output).toContain('no in-stock vegan product matches "paneer"');
    expect(s.carts[0].requirements.must_include).toEqual(["chicken"]);
    await run(s, "set_requirements", { cart: 1, diet: null, budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: null }] });
    expect(s.carts[0].requirements.must_include).toEqual([]);
  });

  it("needs a replacement when a diet change drops an ingredient", async () => {
    const s = fresh();
    const r = await run(s, "set_requirements", { cart: 1, diet: "veg", budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: null }] });
    expect(r.output).toContain("this is a diet change, so the dish needs something in place of chicken");
    expect(s.carts[0].requirements).toMatchObject({ diet: null, must_include: ["chicken"] });
  });

  it("refuses to drop an ingredient the cart doesn't require", async () => {
    const r = await run(fresh(), "set_requirements", { cart: 1, diet: null, budget_inr: null, drop_must_include: [{ kind: "mutton", replaced_by: null }] });
    expect(r.output).toContain("cart 1 doesn't require mutton. It requires: chicken");
  });
});

describe("cheapen", () => {
  it("reaches a budget with the smallest change that's enough", async () => {
    const s = fresh();
    // Premium: chicken ×3 ₹630 + premium rice ₹137 + onion ₹30 + masala ₹58 = ₹855. One pack of chicken fewer is enough.
    const r = await run(s, "cheapen", { cart: 3, budget_inr: 800 });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Cheaper packs and brands: ₹855 → ₹645.");
    expect(s.carts[2].items.find((i) => i.product_id === "p002")?.qty).toBe(2);
    expect([...s.touched]).toEqual([2]);
  });

  it("cuts about 15% when there's no budget", async () => {
    const s = fresh();
    await run(s, "cheapen", { cart: 3, budget_inr: null });
    expect(cartTotal(s.carts[2])).toBeLessThanOrEqual(Math.floor(855 * 0.85));
  });

  it("changes nothing when the budget can't be reached, and says the lowest it can do", async () => {
    const s = fresh();
    const r = await run(s, "cheapen", { cart: 1, budget_inr: 100 });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("can't get cart 1 to ₹100: the lowest they reach is ₹324. Nothing changed.");
    expect(s.carts).toEqual(biryaniCarts());
    expect((await run(s, "cheapen", { cart: 1, budget_inr: 600 })).output).toContain("already ₹534, at or under ₹600. Nothing changed.");
  });

  it("only swaps to products with the cart's diet", async () => {
    // One line: Fresh Paneer ₹95. Malai Paneer ₹72 is the cheaper twin; it's jain, but not vegan.
    const onePaneer = (diet: "jain" | "vegan" | null): AgentState => ({
      carts: [{ name: "Paneer", reason: "", items: [toCartItem(index.get("p001")!, 1, false, true)], requirements: { ...none, diet } }],
      active: 0,
      version: 0,
      touched: new Set(),
    });
    expect((await run(onePaneer(null), "cheapen", { cart: 1, budget_inr: null })).output).toContain("₹95 → ₹72");
    expect((await run(onePaneer("jain"), "cheapen", { cart: 1, budget_inr: null })).output).toContain("₹95 → ₹72");
    expect((await run(onePaneer("vegan"), "cheapen", { cart: 1, budget_inr: null })).output).toContain("no cheaper packs or brands");
  });
});

describe("check_rules and finish", () => {
  it("check_rules lists problems or says the cart passes", async () => {
    const s = fresh();
    expect((await run(s, "check_rules", { cart: 1 })).output).toBe("Cart 1 passes every rule.");
    await run(s, "set_requirements", { cart: 1, diet: null, budget_inr: 400, drop_must_include: [] });
    expect((await run(s, "check_rules", { cart: 1 })).output).toContain("over the ₹400 budget");
  });

  it("finish refuses while a changed cart breaks a rule, then accepts once it's fixed", async () => {
    const s = fresh();
    await run(s, "set_requirements", { cart: 1, diet: "veg", budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: "paneer" }] });
    const refused = await run(s, "finish", { reply: "Done!" });
    expect(refused.ok).toBe(false);
    expect(refused.finished).toBeUndefined();
    expect(refused.output).toContain("can't finish while a cart you changed breaks a rule:");
    expect(refused.output).toContain("- cart 1: Budget: p002 (Chicken Curry Cut) isn't vegetarian");
    await run(s, "swap_item", { cart: 1, product_id: "p002", new_product_id: "p001" });
    const accepted = await run(s, "finish", { reply: "  Swapped chicken for paneer.  " });
    expect(accepted.finished).toEqual({ reply: "Swapped chicken for paneer." });
  });

  it("finish ignores rule problems in carts this turn didn't touch", async () => {
    const s = fresh();
    s.carts[2] = { ...s.carts[2], requirements: { ...s.carts[2].requirements, budget_inr: 100 } };
    expect((await run(s, "finish", { reply: "It's ₹592." })).finished).toBeTruthy();
  });

  it("finish refuses a reply with an amount the agent was never shown", async () => {
    const s = { ...fresh(), amounts: new Set([534, 683]) };
    await run(s, "remove_item", { cart: 1, product_id: "p003" });
    const made = await run(s, "finish", { reply: "Removed the onion; the new total is ₹474." });
    expect(made.output).toContain("your reply mentions ₹474, which isn't a price or total");
    // ₹504 is cart 1's new total and ₹534 its old one, so both are fine.
    expect((await run(s, "finish", { reply: "Removed the onion: ₹534 → ₹504." })).finished).toBeTruthy();
  });

  it("finish refuses an empty reply and cuts a long one", async () => {
    expect((await run(fresh(), "finish", { reply: "   " })).output).toContain("the reply is empty");
    expect((await run(fresh(), "finish", { reply: "x".repeat(1000) })).finished?.reply).toHaveLength(400);
  });
});

describe("what the model and shopper read", () => {
  it("cartView shows requirements, the total, and each item's kind and diet tags", () => {
    const view = cartView(biryaniCarts()[0], 0, index, 0);
    expect(view.split("\n")).toEqual([
      'Cart 1 "Budget" (the shopper is looking at this one): total ₹534',
      "Requirements: diet: none; budget: none; must include: chicken",
      "- p002 | Chicken Curry Cut | Fresho | 500 g | ₹210 × 2 = ₹420 | chicken | high_protein",
      "- p004 | Basmati Rice | Fresho | 1 kg | ₹84 × 1 = ₹84 | basmati_rice | veg,vegan,jain",
      "- p003 | Onion | Fresho | 1 kg | ₹30 × 1 = ₹30 | onion | veg,vegan",
      "- p005 | Salt | Fresho | 1 kg | ₹28 × 1 = ₹28 | salt | veg,vegan,jain | optional, not ticked",
    ]);
  });

  it("statusFor names the product being changed", () => {
    expect(statusFor("swap_item", JSON.stringify({ cart: 1, product_id: "p002", new_product_id: "p001" }), index)).toBe("Swapping Chicken Curry Cut for Fresh Paneer");
    expect(statusFor("search_catalog", JSON.stringify({ text: "paneer" }), index)).toBe("Searching for paneer");
    expect(statusFor("finish", "{}", index)).toBeNull();
  });
});

describe("diffCarts", () => {
  it("reports the end result: removed, added, quantity and requirement changes, and totals", async () => {
    const s = fresh();
    await run(s, "set_requirements", { cart: 1, diet: "veg", budget_inr: null, drop_must_include: [{ kind: "chicken", replaced_by: "paneer" }] });
    await run(s, "remove_item", { cart: 1, product_id: "p002" });
    await run(s, "add_item", { cart: 1, product_id: "p001", qty: 4 });
    await run(s, "set_qty", { cart: 1, product_id: "p004", qty: 2 });
    expect(diffCarts(biryaniCarts(), s.carts)).toEqual([
      {
        cart: 1,
        name: "Budget",
        removed: [{ product_id: "p002", name: "Chicken Curry Cut", qty: 2 }],
        added: [{ product_id: "p001", name: "Fresh Paneer", qty: 4 }],
        qty_changed: [{ product_id: "p004", name: "Basmati Rice", from: 1, to: 2 }],
        requirements: ["now vegetarian", "no longer needs chicken", "now needs paneer"],
        total_before: 534,
        total_after: 380 + 168 + 30,
      },
    ]);
  });

  it("leaves out an item added and removed again", async () => {
    const s = fresh();
    await run(s, "add_item", { cart: 2, product_id: "p001", qty: 1 });
    await run(s, "remove_item", { cart: 2, product_id: "p001" });
    expect(diffCarts(biryaniCarts(), s.carts)).toEqual([]);
  });
});
