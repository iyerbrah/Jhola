import { describe, expect, it } from "vitest";
import { costUsd, pricesFor } from "@/lib/cost";

describe("costUsd", () => {
  it("bills uncached input, cached input and output at their own rates", () => {
    // 1M uncached × $0.75 + 1M cached × $0.075 + 1M output × $4.50
    expect(costUsd("gpt-5.4-mini", { input_tokens: 2_000_000, cached_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(5.325);
  });

  it("matches dated model names", () => {
    expect(pricesFor("gpt-5.4-mini-2026-03-17")).toEqual(pricesFor("gpt-5.4-mini"));
  });

  it("returns null for a model it has no price for", () => {
    expect(costUsd("some-other-model", { input_tokens: 1, cached_tokens: 0, output_tokens: 1 })).toBeNull();
  });
});
