import Link from "next/link";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const STEPS = [
  { t: "Plan", d: "Splits your request into hard requirements (deadline, budget, meal counts) and soft preferences." },
  { t: "Source", d: "Searches restaurants near your venue, reads their menus and policies, and phones the ones with no usable online menu." },
  { t: "Normalize", d: "Converts every quote into one structure. A price with no source is rejected." },
  { t: "Decide", d: "Rejects vendors that fail a hard requirement and ranks the rest. Uncertainty is shown, not hidden." },
  { t: "Pay & confirm", d: "You approve and pay, and the agent calls the restaurant back to confirm." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="grid gap-8 pt-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-5">
          <p className="text-sm font-medium uppercase tracking-wider text-emerald-700">Procurement agent</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Order once. Let your agent ask the city who can fulfill it.
          </h1>
          <p className="text-lg text-stone-600">
            OpenBid gets quotes from restaurants with online menus <em>and</em> calls the ones without. It compares every quote
            against your constraints, explains the pick, and checks out. Every step leaves evidence.
          </p>
          <div className="flex gap-3">
            <Link href="/order/new" className="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-emerald-700">
              Start a food order
            </Link>
          </div>
        </div>
        <Card className="p-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500">Sample order</p>
          <blockquote className="text-lg leading-relaxed">
            “I need lunch for <b>40 people</b> at the office by <b>1:30 PM</b>. My budget is <b>$500</b>. I need <b>10 vegetarian</b> meals,{" "}
            <b>2 vegan</b> meals, and <b>no peanuts</b>.”
          </blockquote>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ["Panda Express", "Catalog"],
              ["Chipotle", "Catalog"],
              ["Local Kitchen", "Phone call"],
            ].map(([n, s]) => (
              <div key={n} className="rounded-lg bg-stone-50 p-2">
                <div className="font-medium">{n}</div>
                <div className="text-stone-500">{s}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        {STEPS.map((s, i) => (
          <Card key={s.t} className="p-4">
            <div className="text-xs text-stone-400">0{i + 1}</div>
            <div className="font-medium">{s.t}</div>
            <p className="mt-1 text-sm text-stone-600">{s.d}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
