import Link from "next/link";
import { listRuns } from "@/lib/store";
import { Badge, Card, money } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const runs = listRuns();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Runs</h1>
      {runs.length === 0 && (
        <Card className="p-6 text-stone-600">
          No runs yet. <Link href="/order/new" className="text-emerald-700 underline">Start a food order</Link>.
        </Card>
      )}
      <div className="space-y-2">
        {runs.map((r) => {
          const sel = r.selection ? r.quotes.find((q) => q.id === r.selection!.quoteId) : null;
          return (
            <Link key={r.id} href={`/runs/${r.id}`}>
              <Card className="flex items-center justify-between p-4 hover:border-emerald-300">
                <div>
                  <div className="font-medium">
                    {r.order.headcount} meals · {money(r.order.budget)} budget · {r.order.deliveryAddress}
                  </div>
                  <div className="text-xs text-stone-500">
                    {new Date(r.createdAt).toLocaleString()} · {r.id}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sel && <span className="text-sm text-stone-600">{sel.vendorName}</span>}
                  <Badge tone={r.status === "confirmed" ? "green" : r.status === "error" || r.status === "confirmation_failed" ? "red" : "blue"}>{r.status.replace(/_/g, " ")}</Badge>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
