"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRun } from "./run-context";
import { Badge, clock, money, Spinner } from "./ui";

const STATUS_TEXT: Record<string, string> = {
  sourcing: "Sourcing quotes",
  awaiting_call_approval: "Waiting for your call approval",
  comparing: "Checking constraints",
  awaiting_selection: "Ready for your decision",
  awaiting_payment: "Waiting for payment",
  paid: "Paid",
  confirming: "Confirming with restaurant",
  confirmed: "Confirmed",
  confirmation_failed: "Confirmation failed",
  error: "Error",
};

export function RunHeader({ id }: { id: string }) {
  const { run, error } = useRun();
  const path = usePathname();
  const tabs = [
    ["Sourcing", `/runs/${id}`],
    ["Compare", `/runs/${id}/compare`],
    ["Questions", `/runs/${id}/questions`],
    ["Calls", `/runs/${id}/calls`],
    ["Audit trail", `/runs/${id}/audit`],
    ["Checkout", `/runs/${id}/checkout`],
  ];
  const busy = run && ["sourcing", "comparing", "confirming"].includes(run.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-stone-500">Run {id}</div>
          {run ? (
            <h1 className="text-xl font-semibold">
              {run.order.headcount} meals by {clock(run.order.deliveryDeadline)} · {money(run.order.budget)} budget
              <span className="ml-2 text-sm font-normal text-stone-500">
                {run.order.vegetarianQty} vegetarian · {run.order.veganQty} vegan{run.order.allergies.length ? ` · no ${run.order.allergies.join(", ")}` : ""}
              </span>
            </h1>
          ) : (
            <h1 className="text-xl font-semibold text-stone-400">Loading…</h1>
          )}
        </div>
        {run && (
          <div className="flex items-center gap-2">
            <Badge tone={run.status === "confirmed" ? "green" : run.status === "error" || run.status === "confirmation_failed" ? "red" : run.status.startsWith("awaiting") ? "amber" : "blue"}>
              {busy && <Spinner />} {STATUS_TEXT[run.status] ?? run.status}
            </Badge>
          </div>
        )}
      </div>
      {(error || run?.error) && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error ?? run?.error}</div>}
      <nav className="flex gap-1 border-b border-stone-200">
        {tabs.map(([label, href]) => {
          const active = path === href;
          return (
            <Link key={href} href={href} className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-emerald-600 font-medium text-emerald-800" : "border-transparent text-stone-600 hover:text-stone-900"}`}>
              {label}
              {label === "Audit trail" && run ? <span className="ml-1 text-xs text-stone-400">{run.audit.length}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
