import type { DietaryFinding, Evidence, OrderRequest, Quote, QuoteItem } from "./types";
import type { CatalogItem, Vendor } from "./vendors";
import { newId } from "./store";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recompute subtotal/tax/total. Totals are null when any price is missing — never guessed. */
export function computeTotals(q: Quote): Quote {
  const priced = q.items.every((i) => i.unitPrice !== null && i.evidence !== null);
  q.subtotal = priced ? round2(q.items.reduce((s, i) => s + i.quantity * (i.unitPrice ?? 0), 0)) : null;
  q.taxEstimate = q.subtotal !== null ? round2(q.subtotal * q.taxRate) : null;
  q.total =
    q.subtotal !== null && q.taxEstimate !== null && q.deliveryFee !== null
      ? round2(q.subtotal + q.taxEstimate + q.deliveryFee)
      : null;
  return q;
}

export function quoteConfidence(q: Quote): number {
  let c = q.sourceType === "phone" ? 0.92 : 0.85; // live confirmation beats a stale snapshot
  c -= 0.08 * q.missingFields.length;
  for (const f of [q.vegetarian, q.vegan]) {
    if (f.status === "uncertain" || f.status === "unknown") c -= 0.08;
  }
  if (q.allergen && q.allergen.status !== "confirmed") c -= 0.04;
  return Math.max(0.05, round2(c));
}

function cheapest(items: CatalogItem[]) {
  return [...items].sort((a, b) => a.price - b.price)[0];
}

export function buildCatalogQuote(
  vendor: Vendor,
  order: OrderRequest,
  findings: { vegetarian: DietaryFinding; vegan: DietaryFinding; allergen: (DietaryFinding & { allergy: string }) | null },
  now = new Date(),
): Quote {
  const cat = vendor.catalog!;
  const evidenceFor = (it: CatalogItem): Evidence => ({
    kind: "catalog_url",
    label: `${vendor.name} catalog snapshot (${cat.snapshotDate})`,
    ref: cat.sourceUrl,
    quote: `${it.name}: $${it.price.toFixed(2)}`,
  });

  const allergyFree = cat.items.filter(
    (it) => !order.allergies.some((a) => it.labels.some((l) => l.toLowerCase().includes(a.toLowerCase()))),
  );
  const standard = cheapest(allergyFree.filter((i) => i.category === "standard"));
  const veg = cheapest(allergyFree.filter((i) => i.category === "vegetarian" || i.category === "vegan"));
  const vegan = cheapest(allergyFree.filter((i) => i.category === "vegan"));

  const standardQty = Math.max(0, order.headcount - order.vegetarianQty - order.veganQty);
  const items: QuoteItem[] = [];
  const missing: string[] = [];

  const push = (it: CatalogItem | undefined, qty: number, category: QuoteItem["category"], unverified = false) => {
    if (qty <= 0) return;
    if (!it) {
      missing.push(`${category} item`);
      items.push({ name: `No ${category} item in catalog`, category, quantity: qty, unitPrice: null, evidence: null });
      return;
    }
    items.push({ name: it.name, category, quantity: qty, unitPrice: it.price, evidence: evidenceFor(it), dietaryUnverified: unverified });
  };

  push(standard, standardQty, "standard");
  push(veg, order.vegetarianQty, "vegetarian");
  if (vegan) push(vegan, order.veganQty, "vegan");
  else push(veg, order.veganQty, "vegan", true); // substitute, flagged — the vegan requirement stays unmet

  const deadline = new Date(order.deliveryDeadline);
  const scheduled = new Date(deadline.getTime() - cat.deliveryBufferMinutes * 60_000);
  const earliest = new Date(now.getTime() + cat.leadTimeMinutes * 60_000);
  const promise = earliest > scheduled ? earliest : scheduled;

  const policyEvidence: Evidence = {
    kind: "menu_document",
    label: `${vendor.name} delivery & catering policy (snapshot)`,
    ref: vendor.docFile,
  };

  const q: Quote = {
    id: newId("q"),
    vendorId: vendor.id,
    vendorName: vendor.name,
    sourceType: "catalog",
    items,
    subtotal: null,
    deliveryFee: cat.deliveryFee,
    deliveryFeeEvidence: { ...policyEvidence, quote: `Catering delivery fee: $${cat.deliveryFee.toFixed(2)} per order.` },
    taxRate: order.taxRate,
    taxEstimate: null,
    total: null,
    minimumOrder: cat.minimumOrder,
    minimumOrderEvidence: { ...policyEvidence, quote: `Catering minimum order: $${cat.minimumOrder} before tax.` },
    canFulfillCount: order.headcount <= cat.maxMealsPerOrder ? "confirmed" : "not_available",
    deliveryPromise: promise.toISOString(),
    deliveryPromiseEvidence: {
      ...policyEvidence,
      kind: "computed",
      quote: `Lead time ${cat.leadTimeMinutes} min; window ends ${cat.deliveryBufferMinutes} min before requested time.`,
    },
    vegetarian: findings.vegetarian,
    vegan: vegan ? findings.vegan : { ...findings.vegan, status: findings.vegan.status === "confirmed" ? "uncertain" : findings.vegan.status },
    allergen: findings.allergen,
    quoteConfidence: 0,
    quoteValidUntil: null,
    quoteValidRaw: `Catalog snapshot from ${cat.snapshotDate}; price must be rechecked at checkout.`,
    missingFields: missing,
    createdAt: new Date().toISOString(),
  };
  computeTotals(q);
  q.quoteConfidence = quoteConfidence(q);
  return q;
}
