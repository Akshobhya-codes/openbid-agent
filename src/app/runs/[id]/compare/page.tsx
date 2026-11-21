"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRun } from "@/components/run-context";
import { allergenConfidence, Badge, Card, clock, EvidenceChip, money, STATUS_WORD, statusTone } from "@/components/ui";
import type { Evaluation, Quote } from "@/lib/types";

export default function ComparePage() {
  const { run } = useRun();
  const canceled = useSearchParams().get("canceled");
  if (!run) return null;
  if (!run.evaluations.length) {
    return <Card className="p-6 text-stone-600">Quotes are still being collected. The comparison appears once every vendor is done.</Card>;
  }
  const missing = run.vendors.filter((v) => !run.quotes.some((q) => q.vendorId === v.vendorId));
  const ordered = [...run.quotes].sort((a, b) => {
    const ea = run.evaluations.find((e) => e.vendorId === a.vendorId)!;
    const eb = run.evaluations.find((e) => e.vendorId === b.vendorId)!;
    return Number(eb.statusLabel === "Best fit") - Number(ea.statusLabel === "Best fit") || Number(eb.eligible) - Number(ea.eligible) || eb.softScore - ea.softScore;
  });
  return (
    <div className="space-y-5">
      {canceled && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Checkout was canceled. Nothing was charged.</div>}
      {run.recommendation && (
        <Card className={`p-5 ${run.recommendation.vendorId ? "border-emerald-300 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="font-semibold">Recommendation</h2>
            {run.recommendation.vendorId && <Badge tone="green">decision confidence {Math.round(run.recommendation.decisionConfidence * 100)}%</Badge>}
          </div>
          <p className="text-sm leading-relaxed">{run.recommendation.summary}</p>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {ordered.map((q) => (
          <VendorCard key={q.id} q={q} e={run.evaluations.find((x) => x.vendorId === q.vendorId)!} />
        ))}
        {missing.map((v) => (
          <Card key={v.vendorId} className="p-4 opacity-70">
            <div className="font-semibold">{v.name}</div>
            <Badge tone="gray">{v.stage === "skipped" ? "Not quoted" : "Failed"}</Badge>
            <p className="mt-2 text-sm text-stone-600">{v.note ?? "No quote collected."}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VendorCard({ q, e }: { q: Quote; e: Evaluation }) {
  const { run, refresh } = useRun();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const best = e.statusLabel === "Best fit";
  const paid = run?.payment?.status === "paid";
  const failed = e.checks.filter((c) => c.hard && c.passed !== true);
  const payable = q.total !== null;

  async function order() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/runs/${run!.id}/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendorId: q.vendorId, allergenAcknowledged: ack, override }) });
    const j = await res.json();
    if (!res.ok) {
      setErr(j.error);
      setBusy(false);
      refresh();
      return;
    }
    window.location.href = j.url;
  }

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-stone-500">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );

  return (
    <Card className={`flex flex-col p-4 ${best ? "ring-2 ring-emerald-500" : ""}`}>
      <div className="mb-2 flex items-start justify-between">
        <div className="text-lg font-semibold">{q.vendorName}</div>
        <Badge tone={best ? "green" : e.eligible ? "blue" : "red"}>{e.statusLabel}</Badge>
      </div>
      <div className="divide-y divide-stone-100">
        {row("Total", <span className={`font-semibold ${q.total !== null && run && q.total > run.order.budget ? "text-red-700" : ""}`}>{money(q.total)}</span>)}
        {row("Delivery", clock(q.deliveryPromise))}
        {row("Vegetarian", <Badge tone={statusTone(q.vegetarian.status)}>{STATUS_WORD[q.vegetarian.status]}</Badge>)}
        {row("Vegan", <Badge tone={statusTone(q.vegan.status)}>{STATUS_WORD[q.vegan.status]}</Badge>)}
        {q.allergen && row(`No-${q.allergen.allergy} confidence`, <Badge tone={statusTone(q.allergen.status)}>{allergenConfidence(q.allergen.status)}</Badge>)}
        {row("Source", q.sourceType === "phone" ? "Live phone quote" : "Online catalog")}
        {row("Quote confidence", `${Math.round(q.quoteConfidence * 100)}%`)}
        {row("Soft score", `${e.softScore}/100`)}
      </div>

      {e.warnings.map((w) => (
        <p key={w} className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">⚠ {w}</p>
      ))}
      {!e.eligible && (
        <ul className="mt-2 space-y-1">
          {e.checks.filter((c) => c.hard && c.passed !== true).map((c) => (
            <li key={c.key} className="rounded-md bg-red-50 p-2 text-xs text-red-800">✕ {c.label}: {c.detail}</li>
          ))}
        </ul>
      )}

      <button onClick={() => setOpen(!open)} className="mt-3 text-left text-xs font-medium text-emerald-700 hover:underline">
        {open ? "Hide" : "Show"} line items, evidence & scoring
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-xs">
          <table className="w-full">
            <tbody>
              {q.items.map((i) => (
                <tr key={i.name + i.category} className="align-top">
                  <td className="py-1 pr-2">
                    {i.quantity}× {i.name}
                    {i.dietaryUnverified && <span className="ml-1 text-amber-700">(vegan not verified)</span>}
                    <div className="mt-0.5"><EvidenceChip e={i.evidence} /></div>
                    {i.evidence?.quote && <div className="mt-0.5 italic text-stone-500">“{i.evidence.quote}”</div>}
                  </td>
                  <td className="py-1 text-right">{money(i.unitPrice)}</td>
                </tr>
              ))}
              <tr><td className="pt-1">Delivery fee <EvidenceChip e={q.deliveryFeeEvidence} /></td><td className="pt-1 text-right">{money(q.deliveryFee)}</td></tr>
              <tr><td>Tax estimate ({(q.taxRate * 100).toFixed(3)}%)</td><td className="text-right">{money(q.taxEstimate)}</td></tr>
              <tr className="font-semibold"><td>Total</td><td className="text-right">{money(q.total)}</td></tr>
            </tbody>
          </table>
          <div>
            <div className="mb-1 font-medium">Hard requirements</div>
            {e.checks.map((c) => (
              <div key={c.key} className="flex gap-2">
                <span>{c.passed === true ? "✓" : c.passed === false ? "✕" : "?"}</span>
                <span className={c.passed === true ? "" : "text-red-700"}>{c.label}{!c.hard ? " (needs your confirmation)" : ""}: <span className="text-stone-500">{c.detail}</span></span>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 font-medium">Soft preferences</div>
            {e.softBreakdown.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="w-32 shrink-0">{s.label}</span>
                <span className="h-1.5 flex-1 rounded bg-stone-100"><span className="block h-1.5 rounded bg-emerald-500" style={{ width: `${s.score * 100}%` }} /></span>
                <span className="w-40 shrink-0 text-right text-stone-500">{s.detail}</span>
              </div>
            ))}
          </div>
          {q.missingFields.length > 0 && <p className="text-red-700">Missing: {q.missingFields.join(", ")}</p>}
          {q.extraAnswers && q.extraAnswers.length > 0 && (
            <div>
              <div className="mb-1 font-medium">Your questions</div>
              {q.extraAnswers.map((a) => (
                <p key={a.question}>
                  <span className="text-stone-500">{a.question}</span> {a.answer}
                </p>
              ))}
            </div>
          )}
          {q.quoteValidRaw && <p className="text-stone-500">Validity: {q.quoteValidRaw}</p>}
        </div>
      )}

      <div className="mt-auto pt-4">
        {payable && !paid && (
          <div className="space-y-2">
            {!e.eligible && (
              <label className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-900">
                <input type="checkbox" checked={override} onChange={(ev) => setOverride(ev.target.checked)} className="mt-0.5 accent-red-600" />
                <span>
                  Order anyway. I accept that {q.vendorName} doesn&apos;t meet: {failed.map((c) => c.label.toLowerCase()).join(", ")}.
                </span>
              </label>
            )}
            {e.requiresAllergenAck && (
              <label className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                <input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} className="mt-0.5 accent-amber-600" />
                I understand {q.vendorName} cannot guarantee a {q.allergen?.allergy}-free kitchen and I still want to order.
              </label>
            )}
            <button
              onClick={order}
              disabled={busy || (e.requiresAllergenAck && !ack) || (!e.eligible && !override)}
              className={`w-full rounded-lg py-2 text-sm font-medium text-white disabled:opacity-40 ${e.eligible ? "bg-emerald-600 hover:bg-emerald-700" : "bg-stone-800 hover:bg-stone-900"}`}
            >
              {busy ? "Opening checkout…" : `${e.eligible ? "Choose" : "Choose anyway"} & pay ${money(q.total)}`}
            </button>
          </div>
        )}
        {!payable && !paid && <p className="text-xs text-stone-500">Can&apos;t be paid: the quote is missing {q.missingFields.join(", ") || "a total"}.</p>}
        {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      </div>
    </Card>
  );
}
