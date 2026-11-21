"use client";

import { useEffect, useRef } from "react";
import { useRun } from "@/components/run-context";
import { Badge, Card, clock, Spinner } from "@/components/ui";
import type { CallRecord } from "@/lib/types";
import type { ScriptQuestion } from "@/lib/questions";

const PROGRESS = ["Calling", "Restaurant answered", "Collecting menu and availability", "Confirming dietary requirements", "Repeating quote for confirmation", "Quote received"];

export default function CallsPage() {
  const { run } = useRun();
  if (!run) return null;
  if (!run.calls.length) {
    return (
      <Card className="p-6 text-stone-600">
        No calls yet. Calls start once a restaurant with no usable menu is found and you approve the call.
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {run.calls.map((c) => (
        <CallPanel key={c.id} c={c} vendorName={run.vendors.find((v) => v.vendorId === c.vendorId)?.name ?? c.vendorId} questions={questionsFor(c, run.callScript ?? [])} />
      ))}
    </div>
  );
}

const CONFIRM_QUESTIONS = [
  { key: "order_confirmed", question: "Will you fulfill this order?" },
  { key: "confirmed_delivery_time", question: "What time will it arrive?" },
  { key: "order_notes", question: "Anything else we should know?" },
];

function questionsFor(c: CallRecord, script: ScriptQuestion[]) {
  if (c.purpose === "confirmation") return CONFIRM_QUESTIONS;
  const qs = script.filter((q) => q.enabled).map((q) => ({ key: q.key, question: q.question }));
  // Older runs used a longer fixed script: fall back to whatever was captured.
  const extra = Object.keys(c.fields).filter((k) => k !== "quote_confirmed" && !qs.some((q) => q.key === k)).map((k) => ({ key: k, question: k.replace(/_/g, " ") }));
  return [...qs, ...extra, { key: "quote_confirmed", question: "Quote read back. Is it correct?" }];
}

function CallPanel({ c, vendorName, questions }: { c: CallRecord; vendorName: string; questions: { key: string; question: string }[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [c.transcript.length]);
  const live = c.status === "dialing" || c.status === "in_progress";
  const stageIdx = c.stageLabel.startsWith("Calling") || c.stageLabel.startsWith("Waiting") ? 0 : c.stageLabel.endsWith("called in") ? 1 : PROGRESS.indexOf(c.stageLabel);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{c.purpose === "quote" ? "Quote call" : "Order confirmation call"}: {vendorName}</span>
          <Badge tone={c.status === "completed" ? "green" : c.status === "failed" ? "red" : "blue"}>{live && <Spinner />} {c.status}</Badge>
        </div>
        <div className="text-xs text-stone-500">
          {c.dialIn ? `inbound on ${c.dialIn}` : `to ${c.toNumber}`} · started {clock(c.startedAt, true)}
          {c.endedAt ? ` · ended ${clock(c.endedAt, true)}` : ""}
          {c.terminationReason ? ` · ${c.terminationReason}` : ""}
        </div>
      </div>
      {c.purpose === "quote" && (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs">
          {PROGRESS.map((p, i) => (
            <li key={p} className={`flex items-center gap-1.5 ${i <= stageIdx ? "text-stone-900" : "text-stone-400"}`}>
              <span className={`h-2 w-2 rounded-full ${i < stageIdx || (i === stageIdx && !live) ? "bg-emerald-500" : i === stageIdx ? "pulse-dot bg-sky-500" : "bg-stone-300"}`} />
              {p === "Calling" ? (c.dialIn ? `Waiting for ${vendorName} to call in` : `Calling ${vendorName}…`) : p}
            </li>
          ))}
        </ol>
      )}
      {c.dialIn && c.status === "dialing" && (
        <div className="bg-violet-600 px-4 py-3 text-white">
          <span className="text-sm">Outbound calling is unavailable. Call the agent now as {vendorName}: </span>
          <span className="text-xl font-semibold">{c.dialIn}</span>
        </div>
      )}
      {c.error && <div className="bg-red-50 px-4 py-2 text-sm text-red-800">{c.error}</div>}
      <div className="grid md:grid-cols-[1.4fr_1fr]">
        <div className="max-h-[32rem] space-y-2 overflow-y-auto p-4">
          {c.transcript.length === 0 && <p className="text-sm text-stone-500">{live ? "Waiting for the restaurant to answer…" : "No conversation recorded."}</p>}
          {c.transcript.map((l, i) => (
            <div key={i} className={`flex ${l.speaker === "AGENT" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${l.speaker === "AGENT" ? "bg-stone-100" : "bg-emerald-600 text-white"}`}>
                <div className={`mb-0.5 text-[10px] uppercase tracking-wide ${l.speaker === "AGENT" ? "text-stone-500" : "text-emerald-100"}`}>
                  {l.speaker === "AGENT" ? "OpenBid agent" : vendorName} · {clock(l.at, true)}
                </div>
                {l.text}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="border-t border-stone-100 bg-stone-50/60 p-4 md:border-l md:border-t-0">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Answers captured</div>
          <p className="mb-3 text-[11px] text-stone-500">The transcript is live speech-to-text and can mishear words. The quote is built from these captured answers.</p>
          <ol className="space-y-2.5">
            {questions.map((q, i) => {
              const v = c.fields[q.key];
              const has = v !== undefined && v !== null && v !== "";
              const current = !has && live && questions.slice(0, i).every((p) => c.fields[p.key] !== undefined || p.key === "quote_confirmed");
              return (
                <li key={q.key} className={`rounded-md px-2 py-1.5 ${current ? "bg-sky-50 ring-1 ring-sky-200" : ""}`}>
                  <div className="flex items-start gap-2 text-[12px] text-stone-500">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${has ? "bg-emerald-500" : current ? "pulse-dot bg-sky-500" : "bg-stone-300"}`} />
                    {q.question}
                  </div>
                  <div className={`pl-4 text-sm ${has ? "font-medium text-stone-900" : "text-stone-400"}`}>{has ? (typeof v === "string" ? v : JSON.stringify(v)) : current ? "asking…" : "not yet"}</div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Card>
  );
}
