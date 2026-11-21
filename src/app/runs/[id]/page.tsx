"use client";

import Link from "next/link";
import { useState } from "react";
import { useRun } from "@/components/run-context";
import { ACTOR_LABEL, Badge, Card, clock, money, Spinner } from "@/components/ui";
import type { VendorStage } from "@/lib/types";

const CATALOG_STEPS: [VendorStage[], string][] = [
  [["searching"], "Searching"],
  [["menu_found"], "Menu found"],
  [["quote_extracted"], "Quote extracted"],
  [["checking_constraints"], "Checking constraints"],
  [["ready"], "Ready for comparison"],
];
const PHONE_STEPS: [VendorStage[], string][] = [
  [["searching"], "Searching"],
  [["no_menu", "awaiting_call_approval"], "No usable menu"],
  [["calling", "answered"], "Calling"],
  [["collecting_menu", "confirming_dietary", "repeating_quote"], "On the call"],
  [["quote_received", "quote_extracted"], "Quote received"],
  [["checking_constraints"], "Checking constraints"],
  [["ready"], "Ready for comparison"],
];

const LIVE_LABEL: Partial<Record<VendorStage, string>> = {
  calling: "Calling…",
  answered: "Restaurant answered",
  collecting_menu: "Collecting menu and availability",
  confirming_dietary: "Confirming dietary requirements",
  repeating_quote: "Repeating quote for confirmation",
  quote_received: "Quote received",
};

export default function SourcingDashboard() {
  const { run, refresh } = useRun();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!run) return null;

  async function callAction(vendorId: string, action: "approve" | "decline") {
    setBusy(vendorId);
    setErr(null);
    const res = await fetch(`/api/runs/${run!.id}/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendorId, action }) });
    if (!res.ok) setErr((await res.json()).error);
    setBusy(null);
    refresh();
  }

  return (
    <div className="space-y-4">
      {err && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</div>}
      <OrderProgress />
      <div className="grid gap-4 md:grid-cols-3">
        {run.vendors.map((vs) => {
          const q = run.quotes.find((x) => x.vendorId === vs.vendorId);
          const call = run.calls.find((c) => c.id === vs.callId);
          const isPhone = vs.sourceType === "phone";
          const steps = isPhone ? PHONE_STEPS : CATALOG_STEPS;
          const idx = steps.findIndex(([s]) => s.includes(vs.stage));
          const name = vs.name;
          const done = vs.stage === "ready";
          const terminalBad = vs.stage === "failed" || vs.stage === "skipped";
          return (
            <Card key={vs.vendorId} className="p-4">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {name}
                  </div>
                  <div className="text-xs text-stone-500">{isPhone ? "No usable online menu: phone vendor" : "Online catalog + menu documents"}</div>
                  {vs.address && (
                    <div className="text-xs text-stone-500">
                      {vs.locationRef ? <a href={vs.locationRef} target="_blank" rel="noreferrer" className="hover:underline">{vs.address}</a> : vs.address}
                      {vs.distanceMiles !== null && !vs.isDemo ? ` · ~${vs.distanceMiles} mi` : ""}
                    </div>
                  )}
                </div>
                {done ? <Badge tone="green">Ready</Badge> : terminalBad ? <Badge tone={vs.stage === "failed" ? "red" : "gray"}>{vs.stage}</Badge> : <Spinner />}
              </div>
              <ol className="space-y-1.5">
                {steps.map(([, label], i) => {
                  const state = terminalBad ? "idle" : i < idx || done ? "done" : i === idx ? "active" : "idle";
                  return (
                    <li key={label} className="flex items-center gap-2 text-sm">
                      <span className={`h-2.5 w-2.5 rounded-full ${state === "done" ? "bg-emerald-500" : state === "active" ? "pulse-dot bg-sky-500" : "bg-stone-200"}`} />
                      <span className={state === "idle" ? "text-stone-400" : state === "active" ? "font-medium" : ""}>
                        {label}
                        {state === "active" && LIVE_LABEL[vs.stage] && label !== LIVE_LABEL[vs.stage] ? <span className="text-sky-700">: {LIVE_LABEL[vs.stage]}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {vs.note && <p className="mt-3 text-xs text-stone-600">{vs.note}</p>}
              {vs.stage === "awaiting_call_approval" && (
                <div className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3 text-sm">
                  <p>
                    {name} has no usable online menu. The agent will call, say it&apos;s an AI, and only collect a quote.{" "}
                    <Link href={`/runs/${run.id}/questions`} className="font-medium text-emerald-800 underline">Edit questions</Link>
                  </p>
                  <div className="flex gap-2">
                    <button disabled={busy === vs.vendorId} onClick={() => callAction(vs.vendorId, "approve")} className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                      {busy === vs.vendorId ? "Dialing…" : `📞 Call ${name}`}
                    </button>
                    <button disabled={busy === vs.vendorId} onClick={() => callAction(vs.vendorId, "decline")} className="rounded-md border border-stone-300 bg-white px-3 py-1">
                      Skip
                    </button>
                  </div>
                </div>
              )}
              {call?.dialIn && call.status === "dialing" && (
                <div className="mt-3 rounded-lg bg-violet-600 p-3 text-white">
                  <div className="text-xs uppercase tracking-wide text-violet-200">Call the agent now</div>
                  <div className="text-2xl font-semibold tracking-wide">{call.dialIn}</div>
                  <div className="text-xs text-violet-100">Answer as {name}. The agent is listening on this number.</div>
                </div>
              )}
              {call && (
                <Link href={`/runs/${run.id}/calls`} className="mt-3 block rounded-lg bg-sky-50 p-3 text-sm hover:bg-sky-100">
                  <div className="font-medium text-sky-900">{call.status === "dialing" ? `Calling ${name}…` : call.stageLabel}</div>
                  <div className="text-xs text-sky-800">
                    {call.transcript.length} utterances · {Object.keys(call.fields).length} fields captured · open transcript →
                  </div>
                </Link>
              )}
              {q && (
                <div className="mt-3 border-t border-stone-100 pt-3 text-sm">
                  <div className="flex justify-between"><span className="text-stone-500">Total</span><span className="font-medium">{money(q.total)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-500">Delivery</span><span>{clock(q.deliveryPromise)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-500">Missing fields</span><span>{q.missingFields.length}</span></div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {run.recommendation && (
        <Card className="flex items-center justify-between p-4">
          <p className="text-sm">{run.recommendation.summary}</p>
          <Link href={`/runs/${run.id}/compare`} className="ml-4 shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            Compare vendors →
          </Link>
        </Card>
      )}
      <Discovery />
      <RecentEvents />
    </div>
  );
}

function OrderProgress() {
  const { run } = useRun();
  if (!run) return null;
  const sel = run.selection ? run.quotes.find((q) => q.id === run.selection!.quoteId) : null;
  const conf = run.restaurantConfirmation;
  const steps: { label: string; done: boolean; active: boolean; detail?: string }[] = [
    { label: "Restaurants found", done: Boolean(run.discovery?.venue), active: !run.discovery?.venue && run.status === "sourcing", detail: run.discovery ? `${run.discovery.candidates.length} nearby` : undefined },
    { label: "Quotes collected", done: run.evaluations.length > 0, active: ["sourcing", "awaiting_call_approval", "comparing"].includes(run.status), detail: `${run.quotes.length}/${run.vendors.length}` },
    { label: "Vendor approved", done: Boolean(run.selection), active: run.status === "awaiting_selection", detail: sel?.vendorName },
    { label: "Payment", done: run.payment?.status === "paid", active: run.status === "awaiting_payment", detail: run.payment ? (run.payment.status === "paid" ? `paid ${money(run.payment.amountTotal)}` : "awaiting payment") : undefined },
    { label: "Restaurant confirmation", done: conf?.status === "confirmed" || conf?.status === "not_applicable", active: conf?.status === "calling", detail: conf?.status.replace(/_/g, " ") },
  ];
  return (
    <Card className="p-3">
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.label} className={`rounded-lg px-3 py-2 text-xs ${s.done ? "bg-emerald-50 text-emerald-900" : s.active ? "bg-sky-50 text-sky-900" : "bg-stone-50 text-stone-400"}`}>
            <div className="flex items-center gap-1.5 font-medium">
              {s.done ? "✓" : s.active ? <Spinner /> : <span>{i + 1}</span>} {s.label}
            </div>
            {s.detail && <div className="mt-0.5 truncate">{s.detail}</div>}
          </li>
        ))}
      </ol>
      {run.payment && run.payment.status !== "paid" && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Waiting for payment of {money(run.payment.amountTotal)} (test card 4242 4242 4242 4242).
          <a href={run.payment.url} className="font-medium underline">Open checkout</a>
        </div>
      )}
    </Card>
  );
}

function Discovery() {
  const { run, refresh } = useRun();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!run?.discovery) return null;
  const { venue, candidates } = run.discovery;
  const chainNames = run.vendors.filter((v) => !v.isDemo && v.sourceType === "catalog").map((v) => v.name.toLowerCase());
  const shown = all ? candidates : candidates.slice(0, 8);

  async function call(c: (typeof candidates)[number]) {
    if (!window.confirm(`This places a real AI phone call to ${c.name} at ${c.phone}.\n\nThe agent will say it's an AI and ask for a catering quote. Continue?`)) return;
    setBusy(c.id);
    setErr(null);
    const res = await fetch(`/api/runs/${run!.id}/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: c.id, action: "approve" }) });
    if (!res.ok) setErr((await res.json()).error);
    setBusy(null);
    refresh();
  }
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Restaurants near the venue</h2>
          {venue && (
            <p className="text-xs text-stone-500">
              {venue.display} · ranked by fit to your filters
            </p>
          )}
        </div>
        <span className="text-xs text-stone-500">{candidates.length} found within {run.order.maxRadiusMiles} mi</span>
      </div>
      {run.discovery.searching ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-sky-800">
            <Spinner /> Searching restaurants near {venue?.display}… {run.discovery.startedAt ? `${Math.max(0, Math.round((Date.now() - Date.parse(run.discovery.startedAt)) / 1000))}s` : ""}
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-stone-100" />
          ))}
        </div>
      ) : (
        candidates.length === 0 && <p className="text-sm text-stone-500">No restaurants found in range.</p>
      )}
      {err && <p className="mb-2 rounded-md bg-red-50 p-2 text-xs text-red-800">{err}</p>}
      <div className="divide-y divide-stone-100">
        {shown.map((c) => {
          const quoted = chainNames.some((n) => c.name.toLowerCase().includes(n));
          const contacted = run.vendors.some((v) => v.vendorId === c.id);
          return (
            <div key={c.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <a href={c.sourceRef} target="_blank" rel="noreferrer" className="font-medium hover:underline">{c.name}</a>
                  {c.cuisine && <span className="text-xs text-stone-500">{c.cuisine}</span>}
                </div>
                <div className="truncate text-xs text-stone-500">
                  {c.address}
                  {c.phone ? ` · ${c.phone}` : ""}
                </div>
                <div className="text-xs text-stone-600">{c.reasons.join(" · ")}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs font-semibold">fit {c.fitScore}</span>
                {quoted ? (
                  <Badge tone="green">quoting from catalog</Badge>
                ) : contacted ? (
                  <Badge tone="blue">called</Badge>
                ) : c.phone && !run.payment ? (
                  <button onClick={() => call(c)} disabled={busy === c.id} className="rounded-md border border-stone-300 px-2 py-0.5 text-xs font-medium hover:bg-stone-50 disabled:opacity-50">
                    {busy === c.id ? "Dialing…" : "📞 Call for quote"}
                  </button>
                ) : (
                  <Badge tone="gray">{c.phone ? "no online menu" : "no phone listed"}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {candidates.length > 8 && (
        <button onClick={() => setAll(!all)} className="mt-2 text-xs text-emerald-700 hover:underline">{all ? "Show fewer" : `Show all ${candidates.length}`}</button>
      )}
    </Card>
  );
}

function RecentEvents() {
  const { run } = useRun();
  if (!run) return null;
  const last = run.audit.slice(-6).reverse();
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Latest agent activity</h2>
        <Link href={`/runs/${run.id}/audit`} className="text-xs text-emerald-700 hover:underline">Full audit trail →</Link>
      </div>
      <ul className="space-y-1 text-sm">
        {last.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="w-20 shrink-0 font-mono text-xs text-stone-400">{clock(e.at, true)}</span>
            <span className="w-24 shrink-0 text-xs uppercase text-stone-400">{ACTOR_LABEL[e.actor] ?? e.actor}</span>
            <span>{e.action}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
