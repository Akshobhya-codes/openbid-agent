"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRun } from "@/components/run-context";
import { Badge, Card, clock, EvidenceChip, money, Spinner } from "@/components/ui";

export default function CheckoutPage() {
  const { run, refresh } = useRun();
  const search = useSearchParams();
  const sessionId = search.get("session_id");
  const returnedFromVerify = search.get("verify") === "1";
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [idCheck, setIdCheck] = useState<string | null>(null);
  const runId = run?.id;
  const paid = run?.payment?.status === "paid";

  // Verify payment server-side with Stripe on return (works without a webhook).
  useEffect(() => {
    if (!sessionId || !runId || paid) return;
    let stopped = false;
    let attempts = 0;
    const attempt = async () => {
      attempts += 1;
      const res = await fetch(`/api/runs/${runId}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const j = await res.json();
      if (!res.ok) setVerifyErr(j.error);
      refresh();
      if (!stopped && res.ok && !j.paid && attempts < 15) setTimeout(attempt, 2000);
    };
    attempt();
    return () => {
      stopped = true;
    };
  }, [sessionId, runId, paid, refresh]);

  if (!run) return null;
  const q = run.selection ? run.quotes.find((x) => x.id === run.selection!.quoteId) : null;
  if (q && returnedFromVerify && !run.payment) {
    return <VerifyReturn runId={run.id} status={idCheck} setStatus={setIdCheck} />;
  }
  if (!q) {
    return (
      <Card className="p-6 text-stone-600">
        No vendor selected yet. <Link href={`/runs/${run.id}/compare`} className="text-emerald-700 underline">Compare vendors</Link>.
      </Card>
    );
  }
  const pay = run.payment;
  const conf = run.restaurantConfirmation;
  const confTone = conf?.status === "confirmed" ? "green" : conf?.status === "calling" ? "blue" : conf?.status === "not_applicable" ? "gray" : conf ? "red" : "gray";

  return (
    <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{q.vendorName}</h2>
          <Badge tone="blue">{q.sourceType === "phone" ? "Live phone quote" : "Online catalog"}</Badge>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr><th className="pb-2">Item</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Unit</th><th className="pb-2 text-right">Line</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {q.items.map((i) => (
              <tr key={i.name + i.category} className="align-top">
                <td className="py-2">{i.name}<div className="mt-0.5"><EvidenceChip e={i.evidence} /></div></td>
                <td className="py-2 text-right">{i.quantity}</td>
                <td className="py-2 text-right">{money(i.unitPrice)}</td>
                <td className="py-2 text-right">{money(i.unitPrice !== null ? i.unitPrice * i.quantity : null)}</td>
              </tr>
            ))}
            <tr><td className="py-1" colSpan={3}>Delivery fee</td><td className="py-1 text-right">{money(q.deliveryFee)}</td></tr>
            <tr><td className="py-1" colSpan={3}>Estimated tax</td><td className="py-1 text-right">{money(q.taxEstimate)}</td></tr>
            <tr className="font-semibold"><td className="py-2" colSpan={3}>Total</td><td className="py-2 text-right">{money(q.total)}</td></tr>
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-stone-600">
          <div>Deliver to: <span className="text-stone-900">{run.order.deliveryAddress}</span></div>
          <div>Promised: <span className="text-stone-900">{clock(q.deliveryPromise)}</span> (deadline {clock(run.order.deliveryDeadline)})</div>
          {run.selection?.allergenAcknowledged && <div className="col-span-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">You acknowledged: {q.allergen?.rawAnswer}</div>}
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-2 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Payment</div>
          <div className="flex items-center gap-2">
            <Badge tone={pay?.status === "paid" ? "green" : "amber"}>{pay?.status === "paid" ? "Paid" : pay ? "Awaiting payment" : "Not started"}</Badge>
            {pay && <span className="text-sm">{money(pay.amountTotal)}</span>}
          </div>
          {pay && <div className="break-all font-mono text-[11px] text-stone-500">Ref {pay.stripeSessionId}</div>}
          {pay && pay.status !== "paid" && (
            <a href={pay.url} className="inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Open checkout</a>
          )}
          {pay && pay.status !== "paid" && <p className="text-xs text-stone-500">Test card 4242 4242 4242 4242, any future date, any CVC.</p>}
          {verifyErr && <p className="text-xs text-red-700">{verifyErr}</p>}
        </Card>
        <Card className="space-y-2 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Restaurant confirmation</div>
          <div className="flex items-center gap-2">
            <Badge tone={confTone}>{conf?.status === "calling" && <Spinner />} {conf ? conf.status.replace(/_/g, " ") : "after payment"}</Badge>
          </div>
          {conf?.detail && <p className="text-sm">{conf.detail}</p>}
          {(() => {
            const cc = run.calls.find((c) => c.id === conf?.callId);
            return cc?.dialIn && cc.status === "dialing" ? (
              <div className="rounded-lg bg-violet-600 p-3 text-white">
                <div className="text-xs text-violet-200">Call the agent to confirm the order</div>
                <div className="text-xl font-semibold">{cc.dialIn}</div>
              </div>
            ) : null;
          })()}
          {conf?.callId && <Link href={`/runs/${run.id}/calls`} className="text-xs text-emerald-700 hover:underline">View confirmation call →</Link>}
        </Card>
        <Card className="space-y-2 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Order report</div>
          <div className="flex gap-2 text-sm">
            <a href={`/api/runs/${run.id}/report`} className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50">Download .md</a>
            <a href={`/api/runs/${run.id}/report?format=json`} className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50">Download .json</a>
          </div>
        </Card>
      </div>
    </div>
  );
}

function VerifyReturn({ runId, status, setStatus }: { runId: string; status: string | null; setStatus: (s: string) => void }) {
  useEffect(() => {
    let stopped = false;
    let tries = 0;
    const check = async () => {
      tries += 1;
      const res = await fetch(`/api/runs/${runId}/verify-buyer`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) return setStatus(j.error);
      if (j.url) return void (window.location.href = j.url);
      setStatus(`Verification status: ${j.status}`);
      if (!stopped && tries < 10) setTimeout(check, 2500);
    };
    check();
    return () => {
      stopped = true;
    };
  }, [runId, setStatus]);
  return (
    <Card className="flex items-center gap-3 p-6 text-sm">
      <Spinner /> Confirming your identity verification, then opening payment… {status && <span className="text-stone-500">{status}</span>}
    </Card>
  );
}
