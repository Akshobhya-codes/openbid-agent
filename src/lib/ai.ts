import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getEnv, requireEnv } from "./env";
import type { RequirementStatus } from "./types";

// OpenAI is used for language understanding only. It never supplies a price:
// every number it extracts must be backed by a verbatim quote that we verify
// against the transcript / typed call fields before accepting it.

function client() {
  return new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
}
const model = () => getEnv("OPENAI_MODEL") ?? "gpt-5";

async function structured<T extends z.ZodTypeAny>(schema: T, name: string, system: string, user: string): Promise<z.infer<T>> {
  const res = await client().responses.parse({
    model: model(),
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    text: { format: zodTextFormat(schema, name) },
  });
  if (!res.output_parsed) throw new Error(`OpenAI returned no parsed output for ${name}`);
  return res.output_parsed as z.infer<T>;
}

export const norm = (s: string) => s.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();

/** True if `needle` appears (whitespace/quote-insensitive) in any haystack. */
export function appearsIn(needle: string, haystacks: string[]) {
  const n = norm(needle);
  return n.length > 0 && haystacks.some((h) => norm(h).includes(n));
}

/** True if the number appears as digits in the text, e.g. 11.5 matches "$11.50" or "11.5". */
export function numberIn(num: number, text: string) {
  const candidates = (text.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  return candidates.some((c) => Math.abs(c - num) < 0.005);
}

// ---------------------------------------------------------------- order parse

const OrderSchema = z.object({
  headcount: z.number().int().nullable(),
  budget: z.number().nullable(),
  deadlineTime24h: z.string().nullable().describe("HH:MM 24h local time of the delivery deadline, if stated"),
  vegetarianQty: z.number().int().nullable(),
  veganQty: z.number().int().nullable(),
  allergies: z.array(z.string()).describe("Allergens to avoid, singular lowercase noun, e.g. 'peanut'"),
  foodPreferences: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
});
export type ParsedOrder = z.infer<typeof OrderSchema>;

export async function parseOrderText(text: string): Promise<ParsedOrder> {
  return structured(
    OrderSchema,
    "order_request",
    "Extract a food catering order request into fields. Only fill a field if the user stated it; otherwise null. Do not infer budgets or counts.",
    text,
  );
}

// ------------------------------------------------- dietary evidence from Senso

const Finding = z.object({
  status: z.enum(["confirmed", "uncertain", "not_available", "unknown"]),
  rawAnswer: z.string().describe("A verbatim sentence copied exactly from one of the source chunks, or empty string if none"),
});
const DietarySchema = z.object({ vegetarian: Finding, vegan: Finding, allergen: Finding });

export async function classifyDietary(args: {
  vendorName: string;
  allergy: string | null;
  chunks: string[];
}): Promise<Record<"vegetarian" | "vegan" | "allergen", { status: RequirementStatus; rawAnswer: string; verified: boolean }>> {
  const out = await structured(
    DietarySchema,
    "dietary_findings",
    [
      "You assess whether a restaurant can meet dietary requirements using ONLY the provided source chunks.",
      "status meanings: confirmed = the source explicitly says the vendor offers it / item is labeled so;",
      "uncertain = partial, hedged, or not guaranteed; not_available = the source says it is not offered or the allergen cannot be avoided;",
      "unknown = the source says nothing.",
      "For the allergen: confirmed only if the source guarantees an item free of it; if the allergen is not an ingredient but cross-contact is possible, that is uncertain.",
      "rawAnswer MUST be copied verbatim from a chunk.",
    ].join(" "),
    JSON.stringify({ vendor: args.vendorName, allergy: args.allergy ?? "none requested", chunks: args.chunks }),
  );
  const verify = (f: { status: RequirementStatus; rawAnswer: string }) => {
    const verified = f.rawAnswer ? appearsIn(f.rawAnswer, args.chunks) : false;
    // An unverifiable quote downgrades the finding: never trust an uncited claim.
    return { status: verified ? f.status : ("unknown" as RequirementStatus), rawAnswer: f.rawAnswer, verified };
  };
  return { vegetarian: verify(out.vegetarian), vegan: verify(out.vegan), allergen: verify(out.allergen) };
}

// --------------------------------------------- quote extraction from the call

const Cited = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ value: v, evidence: z.string().describe("verbatim words from the transcript or a field value that state this") });

const PhoneQuoteSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      category: z.enum(["standard", "vegetarian", "vegan"]),
      unitPrice: z.number().nullable(),
      evidence: z.string().describe("verbatim words stating this item's price"),
    }),
  ),
  canFulfillCount: z.enum(["confirmed", "uncertain", "not_available", "unknown"]),
  deliveryFee: Cited(z.number().nullable()),
  minimumOrder: Cited(z.number().nullable()),
  deliveryTime24h: Cited(z.string().nullable().describe("HH:MM 24h local time the restaurant promised")),
  vegetarian: Finding,
  vegan: Finding,
  allergen: Finding,
  quoteValidRaw: z.string().nullable(),
  quoteValidMinutesFromNow: z.number().nullable().describe("If the restaurant stated a validity period/time, minutes from now; else null"),
});
export type PhoneQuoteExtraction = z.infer<typeof PhoneQuoteSchema>;

export async function extractPhoneQuote(args: {
  vendorName: string;
  transcript: string;
  fields: Record<string, unknown>;
  order: { headcount: number; vegetarianQty: number; veganQty: number; allergy: string | null };
  nowLocal: string;
}): Promise<PhoneQuoteExtraction> {
  return structured(
    PhoneQuoteSchema,
    "phone_quote",
    [
      "Convert a restaurant catering phone call into a structured quote.",
      "Never invent a price, fee, or time. If the restaurant did not state it, use null.",
      "Each evidence string must be copied verbatim from the transcript or a typed field value.",
      "Return one item per meal type offered for: standard (non-vegetarian) meals, vegetarian meals, vegan meals.",
      "Dietary/allergen status: confirmed only if the restaurant clearly said yes; hedged answers are uncertain.",
      "If a fee is conditional (e.g. 'free over $300'), compute this order's subtotal from the stated per-meal prices and quantities and apply the condition; the evidence is the restaurant's conditional statement.",
      "rawAnswer for dietary findings must be verbatim restaurant words.",
    ].join(" "),
    JSON.stringify({ vendor: args.vendorName, order: args.order, nowLocal: args.nowLocal, typedFields: args.fields, transcript: args.transcript }),
  );
}
