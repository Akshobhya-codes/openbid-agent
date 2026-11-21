import type { Evidence, RequirementStatus } from "@/lib/types";

export const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toFixed(2)}`);
export const clock = (iso: string | null | undefined, seconds = false) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }) : "—";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

const TONES = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  gray: "bg-stone-100 text-stone-700 ring-stone-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function statusTone(s: RequirementStatus | undefined): Tone {
  return s === "confirmed" ? "green" : s === "uncertain" ? "amber" : s === "not_available" ? "red" : "gray";
}

export const STATUS_WORD: Record<RequirementStatus, string> = {
  confirmed: "Yes",
  uncertain: "Unclear",
  not_available: "No",
  unknown: "Unknown",
};

export function allergenConfidence(s: RequirementStatus | undefined) {
  return s === "confirmed" ? "High" : s === "uncertain" ? "Medium" : s === "not_available" ? "None" : "Low";
}

export const EVIDENCE_LABEL: Record<Evidence["kind"], string> = {
  catalog_url: "Catalog URL",
  menu_document: "Menu document",
  phone_transcript: "Phone transcript",
  restaurant_confirmation: "Restaurant confirmation",
  user_provided: "User-provided",
  computed: "Computed",
};

export function EvidenceChip({ e }: { e: Evidence | null | undefined }) {
  if (!e) return <Badge tone="red">No source</Badge>;
  const href = e.ref && /^https?:/.test(e.ref) ? e.ref : undefined;
  const body = (
    <span title={e.quote ? `"${e.quote}"` : e.label} className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">
      <span className="font-medium">{EVIDENCE_LABEL[e.kind]}</span>
      <span className="max-w-[16rem] truncate">· {e.label}</span>
    </span>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{body}</a> : body;
}

export const ACTOR_LABEL: Record<string, string> = {
  agent: "agent",
  user: "you",
  system: "system",
  restaurant: "restaurant",
  guava: "phone agent",
  senso: "knowledge base",
  openai: "AI",
  stripe: "payments",
};

export function Spinner() {
  return <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-emerald-500" />;
}
