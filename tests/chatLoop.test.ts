import { describe, expect, it } from "vitest";
import { LlmError } from "@/lib/llm";
import { solveSession } from "@/lib/chat/loop";
import type { Session } from "@/lib/cart/types";
import { addNeed, brief, build, needs, pastaAdds, setup, step, toolResults } from "./chatHarness";
import { ctx } from "./cartFixtures";

/** A built pasta-night session to edit. */
async function built(): Promise<Session> {
  const { turn } = setup([step(["update_cart", build()])]);
  return (await turn("pasta night for 4")).session;
}

describe("first turn", () => {
  it("builds the whole cart in one model call and ends in code", async () => {
    const { turn, events } = setup([step(["update_cart", build({ assumptions: ["Assumed regular pasta"] })])]);
    const r = await turn("stuff for pasta night for 4");
    expect(r.status).toBe("done");
    expect(r.meta).toMatchObject({ model_calls: 1, finished_by: "code" });
    expect(r.reply).toMatch(/^Your cart is ready: 5 items for ₹\d+\.$/);
    expect(r.cart.lines.map((l) => l.need_id)).toEqual(["pasta", "tomato", "cream", "cheese", "garlic"]);
    expect(r.session.brief.summary).toBe("Pasta night, 4 people");
    expect(r.session.picks.pasta).toBe(r.cart.lines[0].product.id);
    expect(r.note.join(" ")).toMatch(/Guessed 120 ml cream for 4/);
    expect(r.meta.cost_inr).toBeGreaterThan(0);
    // The shopper sees what was understood, then the plan, then the cart.
    const order = events.filter((e) => e.type !== "status").map((e) => e.type);
    expect(order.indexOf("brief")).toBeLessThan(order.indexOf("needs"));
    expect(order.lastIndexOf("cart")).toBeGreaterThan(order.indexOf("needs"));
  });

  it("streams: the understanding line reaches the screen while the model is still writing the plan", async () => {
    const events: string[] = [];
    let release!: () => void;
    const { deps } = setup([]);
    const s1 = step(["update_cart", build()]);
    const args = s1.calls[0].arguments;
    deps.model = {
      async next({ onArgs, onCall }) {
        // The model has written the summary but not yet the needs.
        onArgs!("update_cart", args.slice(0, args.indexOf('"people"')));
        await new Promise<void>((r) => (release = r));
        onCall!(s1.calls[0]);
        return s1;
      },
    };
    deps.onEvent = (e) => events.push(e.type);
    const { runChatTurn } = await import("@/lib/chat/loop");
    const p = runChatTurn({ session: (await import("@/lib/chat/session")).emptySession(), message: "pasta night", history: [] }, deps);
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toEqual(["brief"]);
    release();
    const r = await p;
    expect(r.status).toBe("done");
    expect(r.meta.model_calls).toBe(1);
  });

  it("plans with a little reasoning on a turn's first model call, and none after", async () => {
    const efforts: (string | undefined)[] = [];
    const { deps } = setup([]);
    const script = [step(["update_cart", build({ done: false })]), step(["finish", { reply: "Here you go." }])];
    deps.model = {
      async next({ effort, onCall }) {
        efforts.push(effort);
        const s = script.shift()!;
        for (const c of s.calls) onCall?.(c);
        return s;
      },
    };
    const { runChatTurn } = await import("@/lib/chat/loop");
    await runChatTurn({ session: (await import("@/lib/chat/session")).emptySession(), message: "pasta night", history: [] }, deps);
    expect(efforts).toEqual(["low", "none"]);
  });

  it("asks one question alongside the cart when the request is ambiguous", async () => {
    const { turn } = setup([
      step(["update_cart", brief()], ["update_cart", needs({ add: pastaAdds(), done: true })], ["ask_shopper", { question: "Whole wheat or regular pasta?", options: ["Regular", "Whole wheat"] }]),
    ]);
    const r = await turn("pasta night for 4");
    expect(r.status).toBe("done");
    expect(r.cart.lines.length).toBeGreaterThan(0);
    expect(r.question).toEqual({ question: "Whole wheat or regular pasta?", options: ["Regular", "Whole wheat"] });
  });

  it("refuses a kind that isn't in the catalog and suggests close ones", async () => {
    const { turn, model } = setup([
      step(["update_cart", brief()], ["update_cart", needs({ add: [addNeed("pasta", "pastas", 100, "g")], done: true })]),
      step(["update_cart", needs({ add: [addNeed("pasta", "pasta", 100, "g")], done: true })]),
    ]);
    const r = await turn("pasta for 4");
    expect(toolResults(model.sent[1]).join("\n")).toMatch(/"pastas" isn't a kind.*Closest kinds: pasta/);
    expect(r.status).toBe("done");
    expect(r.meta.model_calls).toBe(2);
  });
});

describe("edits", () => {
  it("'for 6 people' changes pack counts only", async () => {
    const session = await built();
    const { turn } = setup([step(["update_cart", brief({ summary: "Pasta night, 6 people", people: 6, done: true })])]);
    const r = await turn("make it 6 people", session);
    expect(r.status).toBe("done");
    expect(r.diff.swapped).toHaveLength(0);
    expect(r.diff.added).toHaveLength(0);
    expect(r.diff.packs.length).toBeGreaterThan(0);
    expect(r.reply).toMatch(/^Done: .*→.*\. ₹\d+ → ₹\d+\.$/);
  });

  it("keeps a rule unless the shopper asks to drop it", async () => {
    const start = await built();
    const session: Session = { ...start, brief: { ...start.brief, rules: [{ kind: "exclude_word", value: "onion", label: "No onions" }] } };
    const { turn, model } = setup([step(["update_cart", brief({ remove_rules: ["No onions"], done: true })]), step(["finish", { reply: "Kept it onion-free." }])]);
    const r = await turn("add some garlic bread", session);
    expect(toolResults(model.sent[1])[0]).toMatch(/the shopper set "No onions" earlier/);
    expect(r.session.brief.rules.map((x) => x.label)).toEqual(["No onions"]);

    const ok = setup([step(["update_cart", brief({ remove_rules: ["No onions"], done: true })])]);
    const r2 = await ok.turn("onions are fine now", session);
    expect(r2.session.brief.rules).toEqual([]);
  });

  it("keeps the diet unless the shopper talks about it", async () => {
    const start = await built();
    const session: Session = { ...start, brief: { ...start.brief, diet: "veg" } };
    const { turn, model } = setup([step(["update_cart", brief({ diet: "any", done: true })]), step(["finish", { reply: "Left it as it was." }])]);
    await turn("cheaper please", session);
    expect(toolResults(model.sent[1])[0]).toMatch(/chose vegetarian earlier/);
  });

  it("a big change waits for the shopper to confirm, and the cart stays as it was", async () => {
    const session = await built();
    const { turn } = setup([step(["update_cart", needs({ remove: ["pasta", "tomato", "cream", "cheese", "garlic"], done: true })])]);
    const r = await turn("start over", session);
    expect(r.status).toBe("confirm");
    expect(r.reply).toMatch(/big change: it empties the cart/);
    expect(r.cart.lines.length).toBe(5);
    expect(r.pending!.cart.lines).toHaveLength(0);
  });
});

describe("finish is checked", () => {
  it("refuses to finish while a check fails unexplained, accepts an honest reply", async () => {
    const session = await built();
    const { turn, model } = setup([
      step(["update_cart", brief({ budget_inr: 50 })]),
      step(["finish", { reply: "Done, it's under budget now." }]),
      step(["finish", { reply: "I can't get this pasta night under ₹50: the lowest is about the cheapest packs of each ingredient." }]),
    ]);
    const r = await turn("keep it under ₹50", session);
    expect(toolResults(model.sent[2]).at(-1)).toMatch(/can't finish while the cart fails: ₹\d+ over the ₹50 budget/);
    expect(r.status).toBe("done");
    expect(r.meta.finished_by).toBe("model");
  });

  it("refuses a reply with an amount no tool showed", async () => {
    const session = await built();
    const { turn, model } = setup([step(["finish", { reply: "It's ₹123456 now." }]), step(["finish", { reply: "It's all set." }])]);
    const r = await turn("is this enough?", session);
    expect(toolResults(model.sent[1])[0]).toMatch(/mentions ₹123456/);
    expect(r.reply).toBe("It's all set.");
  });
});

describe("limits", () => {
  it("gives up after too many model calls and leaves the cart as it was", async () => {
    const session = await built();
    const looks = Array.from({ length: 7 }, (_, i) => step(["search_catalog", { text: `cheese ${i}`, kind: null, diet: null, max_price: null }]));
    const { turn } = setup(looks);
    const r = await turn("hmm", session);
    expect(r).toMatchObject({ status: "gave_up", stop_reason: "model_limit" });
    expect(r.cart).toEqual(solveSession(session, ctx).cart);
  });

  it("stops when the agent repeats itself", async () => {
    const session = await built();
    const same = () => step(["search_catalog", { text: "cheese", kind: null, diet: null, max_price: null }]);
    const { turn } = setup([same(), same(), same()]);
    expect((await turn("cheese?", session)).stop_reason).toBe("repeated_call");
  });

  it("retries a provider failure once", async () => {
    const { turn } = setup([new LlmError("502", "provider"), step(["update_cart", build()])]);
    const r = await turn("pasta night for 4");
    expect(r.status).toBe("done");
  });

  it("gives up cleanly when the provider keeps failing", async () => {
    const { turn } = setup([new LlmError("502", "provider"), new LlmError("502", "provider")]);
    expect(await turn("pasta night")).toMatchObject({ status: "gave_up", stop_reason: "provider_error" });
  });
});

describe("follow-ups (the failures seen in real chats)", () => {
  it("re-sending an existing need replaces it instead of failing the whole edit", async () => {
    const session = await built();
    const { turn, model } = setup([step(["update_cart", needs({ add: [addNeed("cheese", "cheese", 100, "g")], done: true })])]);
    const r = await turn("lots more cheese", session);
    expect(r.status).toBe("done");
    expect(r.meta.model_calls).toBe(1);
    expect(r.session.needs.find((n) => n.id === "cheese")!.amount).toBe(100);
    expect(r.session.needs).toHaveLength(session.needs.length);
    expect(model.sent).toHaveLength(1);
  });

  it("re-sending the whole cart with small changes is a rework, not a big change", async () => {
    const session = await built();
    const all = pastaAdds().map((n) => (n.id === "cheese" ? { ...n, amount: 100 } : n));
    const { turn } = setup([step(["update_cart", needs({ add: all, done: true })])]);
    const r = await turn("lots more cheese", session);
    expect(r.status).toBe("done");
    expect(r.diff.removed).toHaveLength(0);
  });

  it("one bad kind doesn't throw away the rest of an edit", async () => {
    const session = await built();
    const { turn, model } = setup([
      step(["update_cart", needs({ add: [addNeed("bread", "breads_and_loaves", 1, "pack"), addNeed("onion", "onion", 50, "g")], done: true })]),
      step(["finish", { reply: "Added onion; still looking for bread." }]),
    ]);
    const r = await turn("add bread and an onion", session);
    expect(toolResults(model.sent[1])[0]).toMatch(/Not applied, fix and send again:\n- need "bread" not applied: "breads_and_loaves" isn't a kind/);
    expect(r.session.needs.map((n) => n.id)).toContain("onion");
    // A refused part means the model writes the reply, so it can say what's left.
    expect(r.meta.finished_by).toBe("model");
  });

  it("code doesn't end a follow-up that changed nothing visible: the model explains", async () => {
    const session = await built();
    const { turn, model } = setup([step(["update_cart", needs({ add: [{ ...pastaAdds()[0], why: "the main" }], done: true })]), step(["finish", { reply: "That was already the right pasta." }])]);
    const r = await turn("is the pasta right?", session);
    expect(model.sent).toHaveLength(2);
    expect(r.reply).toBe("That was already the right pasta.");
  });

  it("refuses a reply that claims a change when the cart didn't change", async () => {
    const session = await built();
    const { turn, model } = setup([step(["finish", { reply: "I've switched it to proper sandwich bread." }]), step(["finish", { reply: "I haven't changed anything yet." }])]);
    const r = await turn("why this bread?", session);
    expect(toolResults(model.sent[1])[0]).toMatch(/your reply says you changed the cart, but nothing in it changed/);
    expect(r.reply).toBe("I haven't changed anything yet.");
  });
});

describe("planning and close calls", () => {
  it("streams the shopping list to the screen before the needs", async () => {
    const list = ["penne 400 g", "tomato [ripe] 500 g", "cream 120 ml", "cheese 100 g", "garlic 15 g"];
    const s1 = step(["update_cart", build({ shopping_list: list })]);
    const args = s1.calls[0].arguments;
    const { deps, events } = setup([]);
    deps.model = {
      async next({ onArgs, onCall }) {
        onArgs!("update_cart", args.slice(0, args.indexOf('"shopping_list"') + 30)); // the list half-written
        onArgs!("update_cart", args.slice(0, args.indexOf('"people"')));
        onCall!(s1.calls[0]);
        return s1;
      },
    };
    const { runChatTurn } = await import("@/lib/chat/loop");
    const r = await runChatTurn({ session: (await import("@/lib/chat/session")).emptySession(), message: "pasta night", history: [] }, deps);
    const order = events.filter((e) => e.type !== "status").map((e) => e.type);
    expect(order.filter((t) => t === "plan")).toHaveLength(1);
    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("needs"));
    expect(events.find((e) => e.type === "plan")).toEqual({ type: "plan", lines: list });
    expect(r.session.brief.plan).toEqual(list);
  });

  it("a head-count change that changes nothing in the cart goes back to the model", async () => {
    const dish = addNeed("dish", "dishwash", 1, "pack", { per_person: false, group: "cleaning" });
    const { turn: first } = setup([step(["update_cart", brief({ summary: "Dish soap", people: 2, needs: [dish], done: true })])]);
    const session = (await first("dish soap")).session;
    const { turn, model } = setup([step(["update_cart", { ...needs({ done: true }), people: 6 }]), step(["finish", { reply: "Dish soap doesn't depend on how many people there are." }])]);
    const r = await turn("for 6 people", session);
    expect(model.sent).toHaveLength(2);
    expect(r.meta.finished_by).toBe("model");
  });

  it("unsure picks on a first message get one more step to choose, then code ends the turn", async () => {
    const { turn, model } = setup(
      [step(["update_cart", build()]), step(["choose", { choices: [{ need_id: "cheese", option: 2 }], done: true }])],
      { limits: { maxOffers: 4 } },
    );
    const r = await turn("pasta night for 4");
    expect(model.sent).toHaveLength(2);
    expect(toolResults(model.sent[1])[0]).toMatch(/CLOSE CALLS/);
    expect(r.meta).toMatchObject({ model_calls: 2, finished_by: "code" });
    expect(r.session.choices.cheese).toBe(r.cart.lines.find((l) => l.need_id === "cheese")!.product.id);
  });

  it("an edit that adds no needs is not held up by close calls", async () => {
    const session = await built();
    const { turn, model } = setup([step(["update_cart", { ...needs({ done: true }), people: 6 }])], { limits: { maxOffers: 4 } });
    const r = await turn("for 6 people", session);
    expect(model.sent).toHaveLength(1);
    expect(r.meta.finished_by).toBe("code");
  });
});
