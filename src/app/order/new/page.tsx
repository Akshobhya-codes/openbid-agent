"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

const SAMPLE =
  "I need lunch for 40 people at the office by 1:30 PM. My budget is $500. I need 10 vegetarian meals, 2 vegan meals, and no peanuts.";

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Next 1:30 PM that leaves at least 75 minutes of lead time. */
function defaultDeadline(hhmm = "13:30") {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() - Date.now() < 75 * 60_000) d.setDate(d.getDate() + 1);
  return toLocalInput(d);
}

interface Form {
  deliveryAddress: string;
  deliveryDeadline: string;
  headcount: number;
  budget: number;
  vegetarianQty: number;
  veganQty: number;
  allergies: string;
  foodPreferences: string;
  maxRadiusMiles: number;
  permissionToCall: boolean;
  taxRatePct: number;
  variant: "random" | "A_online_only" | "B_online_plus_phone";
}

export default function OrderBuilder() {
  const router = useRouter();
  const [text, setText] = useState(SAMPLE);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ msg: string; missingEnv?: string } | null>(null);
  const [parsedNote, setParsedNote] = useState<string | null>(null);
  const [f, setF] = useState<Form>({
    deliveryAddress: "",
    deliveryDeadline: "",
    headcount: 40,
    budget: 500,
    vegetarianQty: 10,
    veganQty: 2,
    allergies: "peanut",
    foodPreferences: "",
    maxRadiusMiles: 5,
    permissionToCall: false,
    taxRatePct: 8.875,
    variant: "B_online_plus_phone",
  });
  useEffect(() => setF((x) => ({ ...x, deliveryDeadline: x.deliveryDeadline || defaultDeadline() })), []);

  // Start the restaurant search while the user is still filling in the form.
  useEffect(() => {
    if (f.deliveryAddress.trim().length < 8) return;
    const t = setTimeout(() => {
      fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: f.deliveryAddress, maxRadiusMiles: f.maxRadiusMiles, foodPreferences: f.foodPreferences, headcount: f.headcount, vegetarianQty: f.vegetarianQty, veganQty: f.veganQty }),
      }).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
    // Only re-search when inputs that change the results change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.deliveryAddress, f.maxRadiusMiles, f.foodPreferences]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function parse() {
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/parse-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await res.json();
      if (!res.ok) throw Object.assign(new Error(j.error), { missingEnv: j.missingEnv });
      setF((x) => ({
        ...x,
        headcount: j.headcount ?? x.headcount,
        budget: j.budget ?? x.budget,
        vegetarianQty: j.vegetarianQty ?? x.vegetarianQty,
        veganQty: j.veganQty ?? x.veganQty,
        allergies: j.allergies?.length ? j.allergies.join(", ") : x.allergies,
        foodPreferences: j.foodPreferences ?? x.foodPreferences,
        deliveryAddress: j.deliveryAddress ?? x.deliveryAddress,
        deliveryDeadline: j.deadlineTime24h ? defaultDeadline(j.deadlineTime24h) : x.deliveryDeadline,
      }));
      setParsedNote("Fields filled from your request. Review them before starting.");
    } catch (e) {
      setError({ msg: (e as Error).message, missingEnv: (e as { missingEnv?: string }).missingEnv });
    } finally {
      setParsing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const order = {
        deliveryAddress: f.deliveryAddress,
        deliveryDeadline: new Date(f.deliveryDeadline).toISOString(),
        headcount: Number(f.headcount),
        budget: Number(f.budget),
        vegetarianQty: Number(f.vegetarianQty),
        veganQty: Number(f.veganQty),
        allergies: f.allergies.split(",").map((s) => s.trim().toLowerCase().replace(/s$/, "")).filter(Boolean),
        foodPreferences: f.foodPreferences,
        maxRadiusMiles: Number(f.maxRadiusMiles),
        permissionToCall: f.permissionToCall,
        taxRate: Number(f.taxRatePct) / 100,
        rawText: text,
      };
      const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order, variant: f.variant }) });
      const j = await res.json();
      if (!res.ok) throw Object.assign(new Error(j.error), { missingEnv: j.missingEnv });
      router.push(`/runs/${j.id}`);
    } catch (e) {
      setError({ msg: (e as Error).message, missingEnv: (e as { missingEnv?: string }).missingEnv });
      setSubmitting(false);
    }
  }

  const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100";
  const label = "mb-1 block text-xs font-medium text-stone-600";

  return (
    <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">New food order</h1>
        <Card className="space-y-3 p-4">
          <label className={label}>Describe what you need</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={input} />
          <button type="button" onClick={parse} disabled={parsing} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-50">
            {parsing ? "Extracting…" : "Fill the form from this text"}
          </button>
          {parsedNote && <p className="text-xs text-emerald-700">{parsedNote}</p>}
        </Card>
        <Card className="space-y-2 p-4 text-sm text-stone-600">
          <p className="font-medium text-stone-800">Hard requirements</p>
          <p>A vendor that misses the deadline, the budget, the meal count, or a dietary count cannot win.</p>
          <p className="font-medium text-stone-800">Allergies</p>
          <p>If a vendor can&apos;t guarantee an allergy is handled, it can still win. You will have to explicitly acknowledge the risk before ordering.</p>
        </Card>
      </div>

      <Card className="grid grid-cols-2 gap-4 p-5">
        <div className="col-span-2">
          <label className={label}>Delivery address</label>
          <input required value={f.deliveryAddress} onChange={(e) => set("deliveryAddress", e.target.value)} placeholder="e.g. 500 Howard St, San Francisco" className={input} />
        </div>
        <div>
          <label className={label}>Delivery deadline</label>
          <input required type="datetime-local" value={f.deliveryDeadline} onChange={(e) => set("deliveryDeadline", e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Number of people</label>
          <input required type="number" min={1} value={f.headcount} onChange={(e) => set("headcount", Number(e.target.value))} className={input} />
        </div>
        <div>
          <label className={label}>Budget (USD, all-in)</label>
          <input required type="number" min={1} step="0.01" value={f.budget} onChange={(e) => set("budget", Number(e.target.value))} className={input} />
        </div>
        <div>
          <label className={label}>Estimated sales tax %</label>
          <input type="number" min={0} max={20} step="0.001" value={f.taxRatePct} onChange={(e) => set("taxRatePct", Number(e.target.value))} className={input} />
        </div>
        <div>
          <label className={label}>Vegetarian meals</label>
          <input type="number" min={0} value={f.vegetarianQty} onChange={(e) => set("vegetarianQty", Number(e.target.value))} className={input} />
        </div>
        <div>
          <label className={label}>Vegan meals</label>
          <input type="number" min={0} value={f.veganQty} onChange={(e) => set("veganQty", Number(e.target.value))} className={input} />
        </div>
        <div>
          <label className={label}>Allergies (comma-separated)</label>
          <input value={f.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="peanut" className={input} />
        </div>
        <div>
          <label className={label}>Max delivery radius (miles)</label>
          <input type="number" min={0.5} step="0.5" value={f.maxRadiusMiles} onChange={(e) => set("maxRadiusMiles", Number(e.target.value))} className={input} />
        </div>
        <div className="col-span-2">
          <label className={label}>Food preferences</label>
          <input value={f.foodPreferences} onChange={(e) => set("foodPreferences", e.target.value)} placeholder="e.g. rice bowls, nothing too spicy" className={input} />
        </div>
        <label className="col-span-2 flex items-start gap-3 rounded-lg bg-stone-50 p-3 text-sm">
          <input type="checkbox" checked={f.permissionToCall} onChange={(e) => set("permissionToCall", e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span>
            <b>Permission to call restaurants.</b> OpenBid may place AI phone calls to restaurants with no usable online menu.
            The agent says it&apos;s an AI and only collects a quote. If you leave this off, you&apos;ll be asked before each call.
          </span>
        </label>
        {error && (
          <div className="col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error.msg}{error.missingEnv && <span className="font-medium"> (edit .env.local)</span>}
          </div>
        )}
        <button type="submit" disabled={submitting} className="col-span-2 rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {submitting ? "Starting agent…" : "Start sourcing"}
        </button>
      </Card>
    </form>
  );
}
