import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getEnv, requireEnv } from "./env";
import type { OrderRequest } from "./types";

// Restaurant discovery via OpenAI's web_search tool: one call finds real
// restaurants near the venue (each with a source URL) plus the nearest branch
// of each catalog chain. Results are cached per venue for 24h.

export interface Candidate {
  id: string;
  name: string;
  address: string;
  distanceMiles: number;
  source: "openai_web_search";
  sourceRef: string;
  phone?: string;
  website?: string;
  rating?: number;
  cuisine?: string;
  signals: { vegetarian: boolean | null; vegan: boolean | null; delivery: boolean | null; openNow: boolean | null };
  fitScore: number;
  reasons: string[];
}

const Place = z.object({
  name: z.string(),
  address: z.string(),
  distanceMiles: z.number().describe("Approximate driving/walking distance from the venue in miles"),
  cuisine: z.string().nullable(),
  servesVegetarian: z.boolean().nullable(),
  servesVegan: z.boolean().nullable(),
  offersDelivery: z.boolean().nullable(),
  rating: z.number().nullable(),
  phone: z.string().nullable(),
  sourceUrl: z.string().describe("URL of the web page this listing came from"),
});
const SearchSchema = z.object({
  restaurants: z.array(Place),
  chainBranches: z.array(z.object({ chain: z.string(), branch: Place.nullable() })),
});

function toCandidate(p: z.infer<typeof Place>): Candidate {
  return {
    id: `web:${p.name}:${p.address}`.toLowerCase().replace(/\s+/g, "-"),
    name: p.name,
    address: p.address,
    distanceMiles: Math.round(p.distanceMiles * 10) / 10,
    source: "openai_web_search",
    sourceRef: p.sourceUrl,
    phone: p.phone ?? undefined,
    rating: p.rating ?? undefined,
    cuisine: p.cuisine ?? undefined,
    signals: { vegetarian: p.servesVegetarian, vegan: p.servesVegan, delivery: p.offersDelivery, openNow: null },
    fitScore: 0,
    reasons: [],
  };
}

const CACHE_FILE = () => path.join(process.cwd(), "data", "discovery-cache.json");
const CACHE_TTL_MS = 24 * 3600_000;
type CacheEntry = { at: string; candidates: Candidate[]; branches: Record<string, Candidate | null> };

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE(), "utf8"));
  } catch {
    return {};
  }
}

export async function discoverAll(
  address: string,
  order: DiscoveryQuery,
  chains: string[],
): Promise<{ candidates: Candidate[]; branches: Record<string, Candidate | null>; cachedAt: string | null }> {
  const key = [address.toLowerCase().trim().replace(/\s+/g, " "), order.maxRadiusMiles, order.foodPreferences ?? "", chains.join("|")].join(":");
  const hit = readCache()[key];
  if (hit && Date.now() - Date.parse(hit.at) < CACHE_TTL_MS) {
    return { candidates: scoreCandidates(hit.candidates, order), branches: hit.branches, cachedAt: hit.at };
  }
  // Share one in-flight search between the order-form prefetch and the run.
  const g = globalThis as unknown as { __obInflight?: Map<string, Promise<CacheEntry>> };
  g.__obInflight ??= new Map();
  let pending = g.__obInflight.get(key);
  if (!pending) {
    pending = webSearch(address, order, chains)
      .then((entry) => (entry.candidates.length || Object.values(entry.branches).some(Boolean) ? entry : webSearch(address, order, chains)))
      .then((entry) => {
      if (!entry.candidates.length && !Object.values(entry.branches).some(Boolean)) return entry; // never cache an empty search
      const cache = readCache();
      cache[key] = entry;
      fs.mkdirSync(path.dirname(CACHE_FILE()), { recursive: true });
      fs.writeFileSync(CACHE_FILE(), JSON.stringify(cache));
      return entry;
    });
    g.__obInflight.set(key, pending);
    pending.finally(() => g.__obInflight!.delete(key)).catch(() => undefined);
  }
  const entry = await pending;
  return { candidates: scoreCandidates(entry.candidates, order), branches: entry.branches, cachedAt: null };
}

export type DiscoveryQuery = Pick<OrderRequest, "maxRadiusMiles" | "foodPreferences" | "headcount" | "vegetarianQty" | "veganQty">;

async function webSearch(address: string, order: DiscoveryQuery, chains: string[]): Promise<CacheEntry> {
  const res = await new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") }).responses.parse({
    model: getEnv("OPENAI_SEARCH_MODEL") ?? getEnv("OPENAI_MODEL") ?? "gpt-5",
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    input: [
      {
        role: "system",
        content:
          "You find real restaurants using web search. Only return places you found on the web, each with the URL you found it on. Never invent a restaurant, address, or rating. Use null for anything you could not find.",
      },
      {
        role: "user",
        content: [
          `Venue: ${address}`,
          `Find up to 10 restaurants within ${order.maxRadiusMiles} miles that could cater lunch for ${order.headcount} people` +
            `${order.vegetarianQty ? `, including ${order.vegetarianQty} vegetarian` : ""}${order.veganQty ? ` and ${order.veganQty} vegan` : ""} meals` +
            `${order.foodPreferences ? `. Preference: ${order.foodPreferences}` : ""}.`,
          `Also find the nearest branch of each of these chains to the venue: ${chains.join(", ")}.`,
        ].join("\n"),
      },
    ],
    text: { format: zodTextFormat(SearchSchema, "restaurant_search") },
  });
  const out = res.output_parsed;
  if (!out) throw new Error("OpenAI web search returned no results");

  const candidates = out.restaurants.map(toCandidate).filter((c) => c.distanceMiles <= order.maxRadiusMiles);
  const branches: Record<string, Candidate | null> = {};
  for (const ch of chains) {
    const b = out.chainBranches.find((x) => x.chain.toLowerCase() === ch.toLowerCase())?.branch;
    branches[ch] = b ? toCandidate(b) : null;
  }
  return { at: new Date().toISOString(), candidates, branches };
}

export function scoreCandidates(list: Candidate[], order: DiscoveryQuery): Candidate[] {
  const prefWords = (order.foodPreferences ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return list
    .map((c) => {
      const reasons: string[] = [`~${c.distanceMiles} mi from venue`];
      let s = 40 * Math.max(0, 1 - c.distanceMiles / Math.max(order.maxRadiusMiles, 0.1));
      const add = (points: number, reason: string) => {
        s += points;
        reasons.push(reason);
      };
      if (order.vegetarianQty > 0 && c.signals.vegetarian === true) add(20, "serves vegetarian");
      if (order.veganQty > 0 && c.signals.vegan === true) add(10, "serves vegan");
      if (c.signals.delivery === true) add(10, "offers delivery");
      if (prefWords.length && prefWords.some((w) => `${c.name} ${c.cuisine ?? ""}`.toLowerCase().includes(w))) add(10, "matches your preference");
      if (c.rating) add(Math.max(0, (c.rating - 3) * 5), `rated ${c.rating}`);
      return { ...c, fitScore: Math.round(s), reasons };
    })
    .sort((a, b) => b.fitScore - a.fitScore);
}
