/**
 * Pre-builds the answers for the home page's example chips and stores them in the shared
 * Upstash cache, so a first-time visitor's first click answers in about a second.
 * Run after deploying a change that bumps CACHE_VERSION: npm run warm
 */
import { buildCarts } from "../lib/buildCarts";
import { createRedisCache } from "../lib/cache";
import { modelName } from "../lib/llm";
import { redisFromEnv } from "../lib/ratelimit";
import { EXAMPLES } from "../components/QueryInput";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

async function main() {
  const redis = redisFromEnv();
  if (!redis) throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set");
  const cache = createRedisCache(redis, modelName());
  for (const query of EXAMPLES) {
    if (await cache.get(query)) {
      console.log(`already cached: ${query}`);
      continue;
    }
    const res = await buildCarts(query);
    const complete = res.status === "cannot_fulfil" || res.variants.length === 3;
    if (complete) await cache.set(query, res);
    console.log(`${complete ? "cached" : "NOT cached (incomplete)"}: ${query} -> ${res.variants.map((v) => `${v.name} ₹${v.total}`).join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
