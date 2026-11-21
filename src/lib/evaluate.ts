import type { ConstraintCheck, Evaluation, OrderRequest, Quote } from "./types";
import { round2 } from "./quote";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Hard requirements disqualify; soft preferences only rank. */
export function evaluateQuote(q: Quote, order: OrderRequest): Omit<Evaluation, "softScore" | "softBreakdown" | "statusLabel"> {
  const checks: ConstraintCheck[] = [];
  const qty = (cat: string) => q.items.filter((i) => i.category === cat && !i.dietaryUnverified).reduce((s, i) => s + i.quantity, 0);
  const totalMeals = q.items.reduce((s, i) => s + i.quantity, 0);

  checks.push({
    key: "prices",
    label: "Every price has a source",
    hard: true,
    passed: q.items.every((i) => i.unitPrice !== null && i.evidence !== null) && q.deliveryFee !== null,
    detail: q.missingFields.length ? `Missing: ${q.missingFields.join(", ")}` : "All line items and fees are source-backed",
  });
  checks.push({
    key: "deadline",
    label: `Delivery by ${fmtTime(order.deliveryDeadline)}`,
    hard: true,
    passed: q.deliveryPromise ? new Date(q.deliveryPromise) <= new Date(order.deliveryDeadline) : null,
    detail: q.deliveryPromise ? `Promised ${fmtTime(q.deliveryPromise)}` : "No delivery time confirmed",
  });
  checks.push({
    key: "budget",
    label: `Total under $${order.budget}`,
    hard: true,
    passed: q.total !== null ? q.total <= order.budget : null,
    detail: q.total !== null ? `Total $${q.total.toFixed(2)}${q.total > order.budget ? ` ($${round2(q.total - order.budget).toFixed(2)} over)` : ""}` : "Total cannot be computed",
  });
  checks.push({
    key: "count",
    label: `${order.headcount} meals`,
    hard: true,
    passed: q.canFulfillCount === "confirmed" && totalMeals === order.headcount,
    detail: q.canFulfillCount === "confirmed" ? `${totalMeals} meals quoted` : `Capacity ${q.canFulfillCount}`,
  });
  if (order.vegetarianQty > 0) {
    checks.push({
      key: "vegetarian",
      label: `${order.vegetarianQty} vegetarian meals`,
      hard: true,
      passed: q.vegetarian.status === "confirmed" && qty("vegetarian") >= order.vegetarianQty,
      detail: `Vegetarian ${q.vegetarian.status}${q.vegetarian.rawAnswer ? `: "${q.vegetarian.rawAnswer}"` : ""}`,
    });
  }
  if (order.veganQty > 0) {
    checks.push({
      key: "vegan",
      label: `${order.veganQty} vegan meals`,
      hard: true,
      passed: q.vegan.status === "confirmed" && qty("vegan") >= order.veganQty,
      detail: `Vegan ${q.vegan.status}${q.vegan.rawAnswer ? `: "${q.vegan.rawAnswer}"` : ""}`,
    });
  }
  if (q.minimumOrder !== null) {
    checks.push({
      key: "minimum",
      label: "Meets vendor minimum order",
      hard: true,
      passed: q.subtotal !== null ? q.subtotal >= q.minimumOrder : null,
      detail: `Minimum $${q.minimumOrder}`,
    });
  }

  const warnings: string[] = [];
  let requiresAllergenAck = false;
  if (q.allergen) {
    const a = q.allergen;
    const passed = a.status === "not_available" ? false : true;
    checks.push({
      key: "allergen",
      label: `No ${a.allergy}`,
      hard: a.status === "not_available",
      passed,
      detail: `${a.status}: "${a.rawAnswer}"`,
    });
    if (a.status !== "confirmed" && a.status !== "not_available") {
      requiresAllergenAck = true;
      warnings.push(`${a.allergy[0].toUpperCase()}${a.allergy.slice(1)} handling is ${a.status}. You must confirm before ordering. Vendor said: "${a.rawAnswer}"`);
    }
  }

  const eligible = checks.filter((c) => c.hard).every((c) => c.passed === true);
  return { vendorId: q.vendorId, eligible, checks, warnings, requiresAllergenAck };
}

const STATUS_FOR: Record<string, string> = {
  budget: "Over budget",
  vegan: "Fails dietary confidence",
  vegetarian: "Fails dietary confidence",
  allergen: "Cannot meet allergy",
  deadline: "Misses deadline",
  count: "Can't fulfill headcount",
  prices: "Unverified prices",
  minimum: "Below vendor minimum",
};

/** Ranks all quotes on soft preferences, marks the best eligible quote "Best fit". */
export function evaluateAll(quotes: Quote[], order: OrderRequest): Evaluation[] {
  const base = quotes.map((q) => ({ q, e: evaluateQuote(q, order) }));
  const totals = quotes.map((q) => q.total).filter((t): t is number => t !== null);
  const minT = Math.min(...totals), maxT = Math.max(...totals);
  const fees = quotes.map((q) => q.deliveryFee).filter((t): t is number => t !== null);
  const maxFee = Math.max(...fees, 1);

  const dietScore = (s: string) => ({ confirmed: 1, uncertain: 0.4, unknown: 0.2, not_available: 0 }[s] ?? 0);

  const evals: Evaluation[] = base.map(({ q, e }) => {
    const deadline = new Date(order.deliveryDeadline).getTime();
    const marginMin = q.deliveryPromise ? (deadline - new Date(q.deliveryPromise).getTime()) / 60000 : -60;
    const parts = [
      { label: "Lower price", weight: 25, score: q.total === null ? 0 : maxT === minT ? 1 : (maxT - q.total) / (maxT - minT), detail: q.total === null ? "No total" : `$${q.total.toFixed(2)}` },
      { label: "Delivery time margin", weight: 15, score: Math.max(0, Math.min(1, marginMin / 30)), detail: `${Math.round(marginMin)} min before deadline` },
      { label: "Menu variety", weight: 10, score: Math.min(1, new Set(q.items.map((i) => i.name)).size / 3), detail: `${new Set(q.items.map((i) => i.name)).size} distinct items` },
      { label: "Dietary confidence", weight: 20, score: (dietScore(q.vegetarian.status) + dietScore(q.vegan.status) + (q.allergen ? dietScore(q.allergen.status) : 1)) / 3, detail: `veg ${q.vegetarian.status}, vegan ${q.vegan.status}${q.allergen ? `, ${q.allergen.allergy} ${q.allergen.status}` : ""}` },
      { label: "Quote completeness", weight: 10, score: Math.max(0, 1 - q.missingFields.length * 0.25), detail: q.missingFields.length ? `${q.missingFields.length} missing` : "Complete" },
      { label: "Source reliability", weight: 10, score: q.sourceType === "phone" ? 0.9 : 0.75, detail: q.sourceType === "phone" ? "Live restaurant confirmation" : "Catalog snapshot" },
      { label: "Lower delivery fee", weight: 10, score: q.deliveryFee === null ? 0 : 1 - q.deliveryFee / maxFee, detail: q.deliveryFee === null ? "Unknown" : `$${q.deliveryFee.toFixed(2)}` },
    ].map((p) => ({ ...p, score: round2(p.score) }));
    const softScore = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0));
    const firstFail = e.checks.find((c) => c.hard && c.passed !== true);
    return {
      ...e,
      softScore,
      softBreakdown: parts,
      statusLabel: e.eligible ? "Eligible" : firstFail ? STATUS_FOR[firstFail.key] ?? "Fails requirement" : "Fails requirement",
    };
  });

  const best = evals.filter((e) => e.eligible).sort((a, b) => b.softScore - a.softScore)[0];
  if (best) best.statusLabel = "Best fit";
  return evals;
}

export function recommend(quotes: Quote[], evals: Evaluation[]) {
  const best = evals.find((e) => e.statusLabel === "Best fit");
  const name = (id: string) => quotes.find((q) => q.vendorId === id)?.vendorName ?? id;
  const rejected = evals.filter((e) => !e.eligible).map((e) => {
    const fail = e.checks.find((c) => c.hard && c.passed !== true);
    return `${name(e.vendorId)}: ${e.statusLabel.toLowerCase()} (${fail?.detail ?? "requirement not met"})`;
  });
  if (!best) {
    return {
      vendorId: null,
      summary: `No vendor satisfies every hard requirement. ${rejected.join("; ")}.`,
      decisionConfidence: 0,
    };
  }
  const q = quotes.find((x) => x.vendorId === best.vendorId)!;
  const others = evals.filter((e) => e.eligible && e.vendorId !== best.vendorId);
  const only = others.length === 0;
  let summary = `${q.vendorName} ${only ? "is the only vendor that satisfies" : "best satisfies"} the deadline, meal count, dietary requirements, and budget`;
  summary += only ? "." : ` (soft score ${best.softScore} vs ${others.map((o) => `${name(o.vendorId)} ${o.softScore}`).join(", ")}).`;
  if (best.requiresAllergenAck) summary += ` ${best.warnings.join(" ")}`;
  if (rejected.length) summary += ` Rejected: ${rejected.join("; ")}.`;
  const decisionConfidence = round2(q.quoteConfidence * (best.requiresAllergenAck ? 0.9 : 1));
  return { vendorId: best.vendorId, summary, decisionConfidence };
}
