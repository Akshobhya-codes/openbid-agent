"use client";

import { useEffect, useState } from "react";
import { useRun } from "@/components/run-context";
import { Badge, Card } from "@/components/ui";
import type { ScriptQuestion } from "@/lib/questions";

export default function QuestionsPage() {
  const { run, refresh } = useRun();
  const [items, setItems] = useState<ScriptQuestion[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (run?.callScript && items === null) setItems(run.callScript);
  }, [run, items]);

  if (!run) return null;
  if (!items) return <Card className="p-6 text-stone-600">This order has no call script.</Card>;

  const callActive = run.calls.some((c) => c.purpose === "quote" && (c.status === "dialing" || c.status === "in_progress"));
  const dirty = JSON.stringify(items) !== JSON.stringify(run.callScript);

  async function save(next = items!) {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/runs/${run!.id}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: next }) });
    const j = await res.json();
    if (res.ok) {
      setItems(j.items);
      setMsg("Saved. New calls will use these questions.");
      refresh();
    } else setMsg(j.error);
    setSaving(false);
  }

  function addCustom() {
    const text = draft.trim();
    if (!text) return;
    setItems([...items!, { key: `new_${Date.now()}`, question: text, enabled: true, builtin: false, locked: false, fieldType: "text", stage: "collecting_menu" }]);
    setDraft("");
  }

  const enabledCount = items.filter((q) => q.enabled).length;

  return (
    <div className="grid gap-5 md:grid-cols-[1.5fr_1fr]">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Questions the agent asks</h2>
            <p className="text-xs text-stone-500">{enabledCount} questions, plus a quick read-back of the quote at the end.</p>
          </div>
          <button onClick={() => save()} disabled={saving || !dirty} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            {saving ? "Saving…" : "Save questions"}
          </button>
        </div>
        {callActive && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">A call is in progress. Changes apply to the next call.</p>}
        {msg && <p className="mb-3 text-xs text-emerald-700">{msg}</p>}
        <ol className="divide-y divide-stone-100">
          {items.map((q, i) => (
            <li key={q.key} className="flex items-start gap-3 py-2.5">
              <input
                type="checkbox"
                checked={q.enabled}
                disabled={q.locked}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                className="mt-1 h-4 w-4 accent-emerald-600"
                title={q.locked ? "Required to build a quote" : undefined}
              />
              <div className="min-w-0 flex-1">
                {q.builtin ? (
                  <p className={`text-sm ${q.enabled ? "" : "text-stone-400 line-through"}`}>{q.question}</p>
                ) : (
                  <input
                    value={q.question}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))}
                    className="w-full rounded-md border border-stone-200 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                )}
                <div className="mt-0.5 flex gap-1">
                  {q.locked && <Badge tone="gray">required</Badge>}
                  {!q.builtin && <Badge tone="violet">custom</Badge>}
                  {q.fieldType === "multiple_choice" && q.choices && <span className="text-[11px] text-stone-500">options: {q.choices.join(" / ")}</span>}
                </div>
              </div>
              {!q.builtin && (
                <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-xs text-stone-400 hover:text-red-600">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold">Add a custom question</h3>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addCustom();
              }
            }}
            rows={3}
            placeholder="e.g. Do you include utensils and napkins?"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
          <button onClick={addCustom} disabled={!draft.trim()} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-40">
            Add question
          </button>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {["Do you include utensils and napkins?", "Can you label each meal with the person's name?", "Is there a discount for orders over 30 meals?", "Can you set up the food on arrival?"].map((s) => (
              <button key={s} onClick={() => setItems([...items, { key: `new_${Date.now()}_${s.length}`, question: s, enabled: true, builtin: false, locked: false, fieldType: "text", stage: "collecting_menu" }])} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700 hover:bg-stone-200">
                + {s}
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-5 text-xs text-stone-600">
          Answers to custom questions show up next to the restaurant&apos;s quote on the Compare tab. Remember to save before you press Call.
        </Card>
      </div>
    </div>
  );
}
