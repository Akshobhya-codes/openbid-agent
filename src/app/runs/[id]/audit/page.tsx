"use client";

import { useState } from "react";
import { useRun } from "@/components/run-context";
import { ACTOR_LABEL, Badge, Card, clock, EvidenceChip, type Tone } from "@/components/ui";

const ACTOR_TONE: Record<string, Tone> = {
  agent: "green",
  user: "violet",
  restaurant: "amber",
  guava: "blue",
  senso: "blue",
  openai: "gray",
  stripe: "violet",
  system: "gray",
};

export default function AuditPage() {
  const { run } = useRun();
  const [filter, setFilter] = useState<string | null>(null);
  if (!run) return null;
  const actors = [...new Set(run.audit.map((a) => a.actor))];
  const events = filter ? run.audit.filter((a) => a.actor === filter) : run.audit;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFilter(null)} className={`rounded-full px-3 py-1 text-xs ${!filter ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-200"}`}>All {run.audit.length}</button>
          {actors.map((a) => (
            <button key={a} onClick={() => setFilter(a)} className={`rounded-full px-3 py-1 text-xs ${filter === a ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-200"}`}>
              {ACTOR_LABEL[a] ?? a} {run.audit.filter((x) => x.actor === a).length}
            </button>
          ))}
        </div>
        <div className="flex gap-2 text-xs">
          <a href={`/api/runs/${run.id}/report`} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50">Download report (.md)</a>
          <a href={`/api/runs/${run.id}/report?format=json`} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50">Raw audit (.json)</a>
        </div>
      </div>
      <Card className="p-0">
        <ol className="relative">
          {events.map((e, i) => (
            <li key={e.id} className={`grid grid-cols-[5.5rem_1fr] gap-3 px-4 py-3 ${i ? "border-t border-stone-100" : ""}`}>
              <div className="font-mono text-xs text-stone-500">{clock(e.at, true)}</div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ACTOR_TONE[e.actor] ?? "gray"}>{ACTOR_LABEL[e.actor] ?? e.actor}</Badge>
                  <span className="text-sm font-medium">{e.action}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
                  {e.evidence !== undefined && <EvidenceChip e={e.evidence} />}
                  {typeof e.confidence === "number" && <span>confidence {Math.round(e.confidence * 100)}%</span>}
                  {e.decisionAffected && <span>→ decision: {e.decisionAffected}</span>}
                  {e.humanApproval && (
                    <Badge tone={e.humanApproval.granted ? "green" : e.humanApproval.granted === false ? "red" : "amber"}>
                      {e.humanApproval.granted ? `Human approved${e.humanApproval.by ? ` · ${e.humanApproval.by}` : ""}` : e.humanApproval.granted === false ? "Human declined" : "Human approval required"}
                    </Badge>
                  )}
                </div>
                {e.evidence?.quote && <p className="border-l-2 border-stone-200 pl-2 text-xs italic text-stone-500">“{e.evidence.quote}”</p>}
                {e.raw !== undefined && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-stone-500 hover:text-stone-800">Raw data</summary>
                    <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-stone-950 p-3 text-[11px] text-stone-100">{JSON.stringify(e.raw, null, 2)}</pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
