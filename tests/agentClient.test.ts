import { describe, expect, it } from "vitest";
import type { CartChange } from "@/lib/agent/changes";
import { agentRequest, chatHistory, describeChange, describeRequirements, readAgentStream, sendAgentTurn, suggestionsFor } from "@/lib/agent/client";
import { biryaniCarts } from "./agentFixtures";

/** A streamed response whose body arrives in the given chunks (lines can be split across chunks). */
const streamed = (chunks: string[], status = 200) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    }),
    { status, headers: { "content-type": "application/x-ndjson" } },
  );

const done = { type: "done", status: "done", stop_reason: "finished", reply: "Swapped.", carts: [], changes: [], notes: [], meta: { trace_id: "t", latency_ms: 1, model_calls: 1, tool_calls: 1 } };

describe("readAgentStream", () => {
  it("reports each progress line and resolves with the result, even when lines are split across chunks", async () => {
    const seen: string[] = [];
    const lines = `${JSON.stringify({ type: "status", text: "Searching for paneer" })}\n${JSON.stringify({ type: "status", text: "Swapping" })}\n${JSON.stringify(done)}\n`;
    const chunks = [lines.slice(0, 20), lines.slice(20, 61), lines.slice(61)];
    const out = await readAgentStream(streamed(chunks), (t) => seen.push(t));
    expect(seen).toEqual(["Searching for paneer", "Swapping"]);
    expect(out).toMatchObject({ kind: "done", result: { reply: "Swapped." } });
  });

  it("turns an error line, or a stream that stops early, into an error", async () => {
    expect(await readAgentStream(streamed([JSON.stringify({ type: "error", error: "Broke." }) + "\n"]), () => {})).toEqual({ kind: "error", error: "Broke.", status: 200 });
    const cut = await readAgentStream(streamed([JSON.stringify({ type: "status", text: "x" }) + "\n"]), () => {});
    expect(cut).toMatchObject({ kind: "error", error: expect.stringContaining("cut off") });
  });

  it("reads a final line with no newline after it", async () => {
    expect((await readAgentStream(streamed([JSON.stringify(done)]), () => {})).kind).toBe("done");
  });
});

describe("sendAgentTurn", () => {
  const body = agentRequest(biryaniCarts(), 0, "veg please", []);

  it("posts the request and reads the stream", async () => {
    let sent: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => ((sent = { url, init }), streamed([JSON.stringify(done) + "\n"]))) as typeof fetch;
    const out = await sendAgentTurn(body, { onStatus: () => {}, fetchImpl });
    expect(out.kind).toBe("done");
    expect(sent!.url).toBe("/api/agent");
    expect(JSON.parse(String(sent!.init?.body))).toEqual(body);
  });

  it("returns the server's error for a 4xx, with retry_after, and a friendly error offline", async () => {
    const limited = (async () => Response.json({ error: "Too many changes in a short time.", retry_after: 120 }, { status: 429 })) as typeof fetch;
    expect(await sendAgentTurn(body, { onStatus: () => {}, fetchImpl: limited })).toEqual({ kind: "error", error: "Too many changes in a short time.", status: 429, retryAfter: 120 });
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await sendAgentTurn(body, { onStatus: () => {}, fetchImpl: offline })).toMatchObject({ kind: "error", status: 0, error: expect.stringContaining("Couldn't reach Jhola") });
  });
});

describe("agentRequest", () => {
  it("sends product IDs, quantities and flags only, never names or prices", () => {
    const req = agentRequest(biryaniCarts(), 1, "cheaper", []);
    expect(req.active).toBe(1);
    expect(req.carts[0].items[0]).toEqual({ product_id: "p002", qty: 2, optional: false, included: true, note: "" });
    expect(JSON.stringify(req)).not.toContain('"price"');
  });
});

describe("describing a change", () => {
  const change: CartChange = {
    cart: 1,
    name: "Budget",
    removed: [{ product_id: "p002", name: "Chicken Curry Cut", qty: 2 }],
    added: [{ product_id: "p001", name: "Fresh Paneer", qty: 4 }, { product_id: "p003", name: "Onion", qty: 1 }],
    qty_changed: [{ product_id: "p004", name: "Basmati Rice", from: 1, to: 2 }],
    requirements: ["now vegetarian", "now needs paneer"],
    total_before: 534,
    total_after: 494,
  };

  it("lists removals, additions and quantity changes in one line", () => {
    expect(describeChange(change)).toBe("−Chicken Curry Cut ×2, +Fresh Paneer ×4, +Onion, Basmati Rice 1 → 2");
    expect(describeRequirements(change)).toBe("Now vegetarian · now needs paneer");
    expect(describeRequirements({ ...change, requirements: [] })).toBe("");
  });
});

describe("suggestionsFor", () => {
  it("offers vegetarian only for a cart with non-veg items, and a budget below the current total", () => {
    const [biryani] = biryaniCarts(); // ₹534 with chicken
    expect(suggestionsFor(biryani)).toEqual(["Make it vegetarian", "Keep it under ₹400", "Make it cheaper", "Add something for dessert"]);
    const veg = { ...biryani, items: biryani.items.filter((i) => i.product_id !== "p002") };
    expect(suggestionsFor(veg)).not.toContain("Make it vegetarian");
    const already = { ...biryani, requirements: { ...biryani.requirements, diet: "veg" as const } };
    expect(suggestionsFor(already)).not.toContain("Make it vegetarian");
  });

  it("leaves out a budget for a small cart", () => {
    const [biryani] = biryaniCarts();
    const small = { ...biryani, items: biryani.items.filter((i) => i.product_id === "p003") };
    expect(suggestionsFor(small).some((c) => c.startsWith("Keep it under"))).toBe(false);
  });
});

describe("chatHistory", () => {
  it("keeps finished turns as message/reply pairs, the last 6 messages only", () => {
    const turns = [1, 2, 3, 4].map((n) => ({ message: `m${n}`, reply: `r${n}` })).concat([{ message: "working", reply: undefined as unknown as string }]);
    expect(chatHistory(turns).map((m) => m.content)).toEqual(["m2", "r2", "m3", "r3", "m4", "r4"]);
  });
});
