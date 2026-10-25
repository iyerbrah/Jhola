const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, couple: 2, pair: 2,
};

/** Every number the shopper wrote, as digits or words ("for two" -> 2). */
function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(/\d+/g)) found.add(Number(m[0]));
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (NUMBER_WORDS[w]) found.add(NUMBER_WORDS[w]);
  return found;
}

/**
 * Drops assumptions that only repeat what the shopper said ("Assumed 4 people" for "... for 4").
 * An assumption is dropped when it's about a head count and that count is in the query.
 */
export function dropRedundantAssumptions(assumptions: string[], query: string): string[] {
  const given = numbersIn(query);
  return assumptions.filter((a) => {
    const m = a.match(/(\d+)\s*(people|persons?|guests?|kids|children|adults|servings?|friends)/i);
    return !(m && given.has(Number(m[1])));
  });
}
