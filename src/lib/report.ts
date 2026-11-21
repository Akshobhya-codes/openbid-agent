import type { Run } from "./types";

const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
const money = (n: number | null) => (n === null ? "n/a" : `$${n.toFixed(2)}`);

export function buildReport(run: Run): string {
  const o = run.order;
  const sel = run.selection ? run.quotes.find((q) => q.id === run.selection!.quoteId) : null;
  const lines: string[] = [];
  lines.push(`# OpenBid order report: ${run.id}`, "");
  lines.push(`Generated ${new Date().toLocaleString()} · Status: **${run.status}** · Experiment variant: ${run.variant}`, "");
  lines.push("## Request", "");
  lines.push(
    `- Deliver to: ${o.deliveryAddress}`,
    `- Deadline: ${new Date(o.deliveryDeadline).toLocaleString()}`,
    `- Meals: ${o.headcount} (${o.vegetarianQty} vegetarian, ${o.veganQty} vegan)`,
    `- Budget: ${money(o.budget)}`,
    `- Allergies: ${o.allergies.join(", ") || "none"}`,
    "",
  );
  if (sel) {
    lines.push(`## Selected vendor: ${sel.vendorName}`, "");
    lines.push("| Item | Qty | Unit | Source |", "|---|---:|---:|---|");
    for (const i of sel.items) {
      lines.push(`| ${i.name} | ${i.quantity} | ${money(i.unitPrice)} | ${i.evidence?.label ?? "n/a"}${i.evidence?.quote ? `: "${i.evidence.quote}"` : ""} |`);
    }
    lines.push("", `Subtotal ${money(sel.subtotal)} · Delivery ${money(sel.deliveryFee)} · Tax est. ${money(sel.taxEstimate)} · **Total ${money(sel.total)}**`, "");
    lines.push(`- Payment: ${run.payment?.status ?? "not started"}${run.payment?.stripeSessionId ? ` (Stripe ${run.payment.stripeSessionId})` : ""}`);
    lines.push(`- Restaurant confirmation: ${run.restaurantConfirmation?.status ?? "pending"}. ${run.restaurantConfirmation?.detail ?? ""}`, "");
  }
  if (run.recommendation) lines.push("## Recommendation", "", run.recommendation.summary, "");
  lines.push("## Vendor comparison", "", "| Vendor | Total | Delivery | Status | Source | Confidence |", "|---|---:|---|---|---|---:|");
  for (const q of run.quotes) {
    const e = run.evaluations.find((x) => x.vendorId === q.vendorId);
    lines.push(`| ${q.vendorName} | ${money(q.total)} | ${q.deliveryPromise ? t(q.deliveryPromise) : "n/a"} | ${e?.statusLabel ?? "n/a"} | ${q.sourceType} | ${q.quoteConfidence} |`);
  }
  lines.push("", "## Audit trail", "");
  for (const a of run.audit) {
    lines.push(
      `- **${t(a.at)}** [${a.actor}] ${a.action}${a.evidence ? ` (evidence: ${a.evidence.label}${a.evidence.ref ? `, ${a.evidence.ref}` : ""})` : ""}${a.humanApproval?.granted ? " (approved by human)" : ""}`,
    );
  }
  for (const c of run.calls) {
    lines.push("", `## Call transcript: ${c.purpose} (${c.guavaCallId ?? c.id})`, "");
    for (const l of c.transcript) lines.push(`- **${l.speaker}**: ${l.text}`);
  }
  return lines.join("\n") + "\n";
}
