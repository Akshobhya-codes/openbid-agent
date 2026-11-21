/**
 * Firedrill simulation suite for OpenBid's phone-quote agent.
 *
 * Each scenario is a restaurant-owner persona's side of a quote call (the way
 * it arrives from the phone line: speech-to-text lines + typed answers). The
 * callback runs OpenBid's real extraction + evidence validator (buildPhoneQuote),
 * and Firedrill grades the output with exact USD checks and a grounding rubric.
 *
 *   npm run firedrill          # run on Firedrill (after `npx firedrill-run init`)
 *   npm run firedrill -- --dry # run locally, check results in the terminal
 */
import { Firedrill, NUMERIC_CHECK_VERSION, ASSESSMENT_POLICY_VERSION } from "@firedrill-run/sdk";
import { buildPhoneQuote } from "../src/lib/pipeline";
import type { OrderRequest, TranscriptLine } from "../src/lib/types";

type Line = [speaker: "AGENT" | "RESTAURANT", text: string];
interface Persona {
  id: string;
  name: string;
  restaurant: string;
  lines: Line[];
  fields?: Record<string, string>;
  expect: Partial<Record<"standardPrice" | "vegetarianPrice" | "veganPrice" | "deliveryFee" | "veganPriceAccepted" | "peanutUncertain" | "deliveryMinutesBeforeDeadline", number>>;
}

const Q = {
  count: "Can you prepare 40 individual meals?",
  std: "For the 28 regular meals, what dish would you suggest and what's the price per meal?",
  veg: "For 10 vegetarian meals, which dish and what price per meal?",
  vegan: "And for 2 vegan meals?",
  peanut: "Can you guarantee the meals are peanut-free? Yes, no, or not guaranteed?",
  fee: "What's the delivery fee?",
  time: "What time can you deliver it? We need it by 1:30 PM.",
};

const PERSONAS: Persona[] = [
  {
    id: "prices-in-words",
    name: "Owner says every number in words",
    restaurant: "Golden Wok",
    lines: [
      ["AGENT", Q.count], ["RESTAURANT", "Yeah we can do forty."],
      ["AGENT", Q.std], ["RESTAURANT", "Orange chicken rice bowl, eight fifty a bowl."],
      ["AGENT", Q.veg], ["RESTAURANT", "Veggie fried rice bowl, seven seventy five."],
      ["AGENT", Q.vegan], ["RESTAURANT", "Tofu and greens, also seven seventy five, it's vegan."],
      ["AGENT", Q.peanut], ["RESTAURANT", "Yes, no peanuts in our kitchen at all."],
      ["AGENT", Q.fee], ["RESTAURANT", "Twelve bucks."],
      ["AGENT", Q.time], ["RESTAURANT", "One fifteen."],
    ],
    expect: { standardPrice: 8.5, vegetarianPrice: 7.75, veganPrice: 7.75, deliveryFee: 12, deliveryMinutesBeforeDeadline: 15 },
  },
  {
    id: "vague-pricer",
    name: "Owner is vague, then commits",
    restaurant: "Mama Rosa's",
    lines: [
      ["AGENT", Q.count], ["RESTAURANT", "Forty? Yeah, should be fine."],
      ["AGENT", Q.std], ["RESTAURANT", "Chicken pesto pasta, it's usually somewhere around nine, nine fifty. Let's say $9.50."],
      ["AGENT", Q.veg], ["RESTAURANT", "Penne marinara, $8."],
      ["AGENT", Q.vegan], ["RESTAURANT", "Marinara without cheese works, same $8."],
      ["AGENT", Q.peanut], ["RESTAURANT", "Yes."],
      ["AGENT", Q.fee], ["RESTAURANT", "Delivery's free over three hundred."],
      ["AGENT", Q.time], ["RESTAURANT", "1:20"],
    ],
    expect: { standardPrice: 9.5, vegetarianPrice: 8, veganPrice: 8, deliveryFee: 0, deliveryMinutesBeforeDeadline: 10 },
  },
  {
    id: "upseller",
    name: "Owner pushes a premium option first",
    restaurant: "Seoul Bowl",
    lines: [
      ["AGENT", Q.count], ["RESTAURANT", "Sure."],
      ["AGENT", Q.std], ["RESTAURANT", "You really want the premium bulgogi at $14. But if you need budget, the regular chicken bowl is $11."],
      ["AGENT", "Let's go with the regular chicken bowl."], ["RESTAURANT", "Okay, regular chicken bowl at eleven."],
      ["AGENT", Q.veg], ["RESTAURANT", "Bibimbap, $10."],
      ["AGENT", Q.vegan], ["RESTAURANT", "Bibimbap no egg, $10."],
      ["AGENT", Q.peanut], ["RESTAURANT", "Yes."],
      ["AGENT", Q.fee], ["RESTAURANT", "$20."],
      ["AGENT", Q.time], ["RESTAURANT", "Twelve forty five."],
    ],
    expect: { standardPrice: 11, vegetarianPrice: 10, veganPrice: 10, deliveryFee: 20, deliveryMinutesBeforeDeadline: 45 },
  },
  {
    id: "allergen-unsure",
    name: "Owner hedges on peanuts",
    restaurant: "Thai Garden",
    lines: [
      ["AGENT", Q.count], ["RESTAURANT", "Yes."],
      ["AGENT", Q.std], ["RESTAURANT", "Pad see ew, $12."],
      ["AGENT", Q.veg], ["RESTAURANT", "Veggie curry, $11."],
      ["AGENT", Q.vegan], ["RESTAURANT", "Veggie curry is vegan if we skip fish sauce, $11."],
      ["AGENT", Q.peanut], ["RESTAURANT", "Hmm, we cook with peanut oil sometimes. We can make it separately but I can't promise."],
      ["AGENT", Q.fee], ["RESTAURANT", "$15."],
      ["AGENT", Q.time], ["RESTAURANT", "1:25 PM."],
    ],
    fields: { allergen_policy: "not guaranteed" },
    expect: { standardPrice: 12, vegetarianPrice: 11, veganPrice: 11, deliveryFee: 15, peanutUncertain: 1 },
  },
  {
    id: "never-stated-price",
    name: "Read-back contains a price the owner never said",
    restaurant: "Corner Deli",
    lines: [
      ["AGENT", Q.count], ["RESTAURANT", "Yep."],
      ["AGENT", Q.std], ["RESTAURANT", "Turkey club, $10."],
      ["AGENT", Q.veg], ["RESTAURANT", "Caprese sandwich, $9."],
      ["AGENT", Q.vegan], ["RESTAURANT", "Uh, I'd have to check with the chef on vegan."],
      ["AGENT", Q.fee], ["RESTAURANT", "Ten dollars."],
      ["AGENT", Q.time], ["RESTAURANT", "1:00 PM."],
      ["AGENT", "To confirm: 28 turkey clubs at $10, 10 caprese at $9, 2 vegan wraps at $9, $10 delivery, by 1 PM. Correct?"],
      ["RESTAURANT", "Yeah."],
    ],
    expect: { standardPrice: 10, vegetarianPrice: 9, veganPriceAccepted: 0, deliveryFee: 10 },
  },
  {
    id: "noisy-speech-to-text",
    name: "Phone line mishears; typed answers are clean",
    restaurant: "Local Kitchen",
    lines: [
      ["AGENT", Q.count], ["RESTAURANT", "Yeah."],
      ["AGENT", Q.std], ["RESTAURANT", "Um I would suggest rice bowls around eight dollars per bowl."],
      ["AGENT", Q.veg], ["RESTAURANT", "Um horizable."], ["RESTAURANT", "Um Risebow or seven dollar seats."],
      ["AGENT", Q.vegan], ["RESTAURANT", "Um again, we can make vegan meals for seven dollars each."],
      ["AGENT", Q.fee], ["RESTAURANT", "Twenty dollars."],
      ["AGENT", Q.time], ["RESTAURANT", "I'll deliver it by one twenty PM."],
    ],
    fields: { standard_meal: "rice bowls, $8 per bowl", vegetarian_meal: "rice bowl, $7", vegan_meal: "vegan meals for seven dollars each", delivery_fee: "Twenty dollars", delivery_time: "1:20 PM" },
    expect: { standardPrice: 8, vegetarianPrice: 7, veganPrice: 7, deliveryFee: 20, deliveryMinutesBeforeDeadline: 10 },
  },
];

function order(): OrderRequest {
  const d = new Date();
  d.setHours(13, 30, 0, 0);
  return { deliveryAddress: "500 Howard St, San Francisco, CA", deliveryDeadline: d.toISOString(), headcount: 40, budget: 500, vegetarianQty: 10, veganQty: 2, allergies: ["peanut"], foodPreferences: "", maxRadiusMiles: 5, permissionToCall: true, taxRate: 0.08875 };
}

/** The application under test: OpenBid's real transcript → quote path. */
async function runAgent(input: { restaurant: string; lines: Line[]; fields?: Record<string, string> }) {
  const o = order();
  const t0 = new Date().toISOString();
  const transcript: TranscriptLine[] = input.lines.map(([speaker, text]) => ({ speaker, text, at: t0 }));
  const { quote, rejected } = await buildPhoneQuote({
    vendor: { id: `sim-${input.restaurant}`, name: input.restaurant },
    order: o,
    call: { id: "sim", guavaCallId: null, transcript, fields: input.fields ?? {} },
  });
  const price = (cat: string) => quote.items.find((i) => i.category === cat)?.unitPrice ?? null;
  return {
    standardPrice: price("standard"),
    vegetarianPrice: price("vegetarian"),
    veganPrice: price("vegan"),
    veganPriceAccepted: price("vegan") === null ? 0 : 1,
    deliveryFee: quote.deliveryFee,
    deliveryMinutesBeforeDeadline: quote.deliveryPromise ? Math.round((Date.parse(o.deliveryDeadline) - Date.parse(quote.deliveryPromise)) / 60000) : null,
    peanutUncertain: quote.allergen?.status === "uncertain" ? 1 : 0,
    total: quote.total,
    missingFields: quote.missingFields,
    rejectedValues: rejected,
    quote: quote.items.map((i) => `${i.quantity}x ${i.name} @ ${i.unitPrice === null ? "UNVERIFIED" : `$${i.unitPrice}`} — evidence: ${i.evidence?.quote ?? "none"}`),
  };
}

const usd = { schemaVersion: NUMERIC_CHECK_VERSION, unit: "USD", absoluteTolerance: 0.01 };

const recipe = {
  schemaVersion: "2026-10-14",
  name: "OpenBid phone-quote extraction: restaurant personas",
  target: { kind: "native", name: "openbid-quote-extraction" },
  scenarios: PERSONAS.map((p) => ({
    id: p.id,
    name: p.name,
    input: { restaurant: p.restaurant, lines: p.lines, fields: p.fields ?? {} },
    checks: Object.entries(p.expect).map(([k, v]) => ({
      id: `${k}`,
      description: `${k} should be ${v}`,
      path: `/output/${k}`,
      comparator: "equals",
      expected: v,
      required: true,
      ...(k.endsWith("Price") || k === "deliveryFee" ? { numeric: usd } : {}),
    })),
    rubric: {
      id: "grounding",
      version: "1",
      policyVersion: ASSESSMENT_POLICY_VERSION,
      dimensions: [
        {
          id: "grounding",
          applicability: { state: "applicable" },
          missingEvidence: "not_assessable",
          description:
            "Judge output.quote against input.lines. Only RESTAURANT lines count as the restaurant's words. Every accepted price must be something the restaurant said; a price only the AGENT said must be UNVERIFIED. Penalize any invented or wrong price.",
          anchors: [
            "Accepts a price the restaurant never said, or records a wrong price.",
            "Several prices missing or attributed to the wrong item.",
            "Prices correct but one stated price was dropped as unverified.",
            "All stated prices captured correctly, nothing invented, minor naming issues.",
            "Every stated price captured exactly with verbatim evidence; nothing invented; unstated prices marked unverified.",
          ],
        },
      ],
    },
  })),
  repetitions: 1,
  concurrency: 2,
  limits: { timeoutMs: 120000, maxRuns: PERSONAS.length, maxOutputBytes: 16384 },
  gate: { requireCompleted: true, requireExactChecks: true, minimumLevels: { grounding: 3 } },
};

async function dryRun() {
  let pass = 0, total = 0;
  for (const p of PERSONAS) {
    const out = await runAgent({ restaurant: p.restaurant, lines: p.lines, fields: p.fields });
    const results = Object.entries(p.expect).map(([k, v]) => {
      const actual = (out as Record<string, unknown>)[k];
      const ok = typeof actual === "number" && Math.abs(actual - v) <= 0.01;
      total += 1;
      pass += ok ? 1 : 0;
      return `${ok ? "✓" : "✗"} ${k}=${actual ?? "null"}${ok ? "" : ` (expected ${v})`}`;
    });
    console.log(`\n${p.name} [${p.restaurant}]\n  ${results.join("\n  ")}`);
    if (out.rejectedValues.length) console.log(`  rejected (no source): ${out.rejectedValues.join("; ")}`);
  }
  console.log(`\n${pass}/${total} exact checks passed`);
}

async function main() {
  if (process.argv.includes("--dry")) return dryRun();
  const client = Firedrill.fromConfig();
  const result = await client.simulate(recipe as never, async (input) => runAgent(input as { restaurant: string; lines: Line[]; fields?: Record<string, string> }));
  console.log("batch:", result.batch.counts);
  console.log("gate:", result.gate);
  console.log("report:", result.reportUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
