import { describe, expect, it } from "vitest";
import { dropRedundantAssumptions } from "@/lib/assumptions";

describe("dropRedundantAssumptions", () => {
  it("drops a head count the shopper already gave, in digits or words", () => {
    expect(dropRedundantAssumptions(["Assumed 4 people"], "chicken biryani for 4")).toEqual([]);
    expect(dropRedundantAssumptions(["Assumed 2 people"], "dinner for two tonight")).toEqual([]);
    expect(dropRedundantAssumptions(["Assumed 10 kids", "Assumed snacks only"], "party snacks for 10 kids")).toEqual(["Assumed snacks only"]);
  });

  it("keeps real assumptions", () => {
    expect(dropRedundantAssumptions(["Assumed 2 people"], "rajma chawal")).toEqual(["Assumed 2 people"]);
    expect(dropRedundantAssumptions(["Assumed 4 people"], "gift under 1000")).toEqual(["Assumed 4 people"]);
  });
});
