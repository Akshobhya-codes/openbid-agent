"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, money } from "@/components/ui";

interface Data {
  enabled: boolean;
  totals?: { runs: number; paidOrders: number; spend: number; confirmed: number };
  vendors?: { vendorName: string; sourceType: string; quotes: number; avgTotal: number | null; minTotal: number | null; wins: number }[];
  actors?: { actor: string; events: number }[];
  error?: string;
}
interface Hit {
  runId: string;
  vendorName: string;
  total: number | null;
  summary: string;
  score: number;
  createdAt: string;
}

export default function InsightsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("vegan rice bowls under $10 with delivery");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetch("/api/insights").then(async (r) => setData(await r.json()));
  }, []);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setSearching(true);
    const r = await fetch(`/api/insights?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    setHits(j.results ?? []);
    setSearching(false);
  }

  if (!data) return <p className="text-stone-500">Loading…</p>;
  if (!data.enabled) return <Card className="p-6 text-stone-600">Order history isn&apos;t connected yet.</Card>;
  if (data.error) return <Card className="p-6 text-red-700">{data.error}</Card>;
  const t = data.totals!;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Order history</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Orders sourced", t.runs],
          ["Paid orders", t.paidOrders],
          ["Confirmed by restaurant", t.confirmed],
          ["Total spend", money(Number(t.spend))],
        ].map(([k, v]) => (
          <Card key={String(k)} className="p-4">
            <div className="text-xs text-stone-500">{k}</div>
            <div className="text-2xl font-semibold">{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h2 className="mb-1 font-semibold">Search past quotes</h2>
        <p className="mb-3 text-xs text-stone-500">Semantic search across every quote the agent has collected.</p>
        <form onSubmit={search} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />
          <button disabled={searching} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{searching ? "Searching…" : "Search"}</button>
        </form>
        {hits && (
          <ul className="mt-3 divide-y divide-stone-100">
            {hits.length === 0 && <li className="py-2 text-sm text-stone-500">No quotes yet.</li>}
            {hits.map((h, i) => (
              <li key={i} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <Link href={`/runs/${h.runId}/compare`} className="font-medium hover:underline">{h.vendorName}</Link>
                  <span className="flex items-center gap-2">
                    <span>{money(h.total)}</span>
                    <Badge tone="blue">match {h.score}</Badge>
                  </span>
                </div>
                <p className="text-xs text-stone-500">{h.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Vendors</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr><th className="pb-2">Vendor</th><th className="pb-2">Source</th><th className="pb-2 text-right">Quotes</th><th className="pb-2 text-right">Avg total</th><th className="pb-2 text-right">Lowest</th><th className="pb-2 text-right">Chosen</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.vendors!.map((v) => (
              <tr key={v.vendorName + v.sourceType}>
                <td className="py-2 font-medium">{v.vendorName}</td>
                <td className="py-2">{v.sourceType === "phone" ? "Phone" : "Catalog"}</td>
                <td className="py-2 text-right">{v.quotes}</td>
                <td className="py-2 text-right">{money(v.avgTotal === null ? null : Number(v.avgTotal))}</td>
                <td className="py-2 text-right">{money(v.minTotal === null ? null : Number(v.minTotal))}</td>
                <td className="py-2 text-right">{v.wins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
