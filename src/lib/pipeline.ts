import { audit, getRun, newId, saveRun, updateRun } from "./store";
import type { CallRecord, DietaryFinding, Evidence, OrderRequest, Quote, QuoteItem, Run, Variant, VendorStage } from "./types";
import { loadVendors, type Vendor } from "./vendors";
import { searchVendor, seedSenso, ingestTranscript } from "./senso";
import { appearsIn, classifyDietary, extractPhoneQuote, norm, numberIn } from "./ai";
import { buildCatalogQuote, computeTotals, quoteConfidence, round2 } from "./quote";
import { evaluateAll, recommend } from "./evaluate";
import { startConfirmationCall, startQuoteCall, STAGE_LABEL, type CallHooks } from "./guava";
import { track, trackExposure } from "./amplitude";
import { createCheckout, stripe } from "./stripe";
import { getEnv, requireEnv } from "./env";
import { numberWordsToDigits, spokenNumbers } from "./numbers";
import { discoverAll } from "./discovery";
import { createInquiry, getInquiry, hostedFlowUrl, personaEnabled } from "./persona";
import { semanticSearch, singlestoreEnabled, vendorHistory } from "./singlestore";
import { defaultScript, sanitizeScript, type ScriptQuestion } from "./questions";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const TERMINAL: VendorStage[] = ["ready", "skipped", "failed"];

function setStage(runId: string, vendorId: string, stage: VendorStage, note?: string) {
  updateRun(runId, (r) => {
    const v = r.vendors.find((x) => x.vendorId === vendorId);
    if (v) {
      v.stage = stage;
      if (note !== undefined) v.note = note;
    }
  });
}

async function metric(run: Run, event: string, props: Record<string, unknown> = {}) {
  const res = await track(run.id, run.variant, event, props).catch((e) => ({ sent: false as const, reason: String(e) }));
  if (!res.sent && res.reason !== "AMPLITUDE_API_KEY not set") {
    audit(run.id, { action: `Amplitude event "${event}" not recorded`, actor: "system", raw: res });
  }
}

// ------------------------------------------------------------------ create

export function createRun(order: OrderRequest, variant: Variant): Run {
  const now = new Date().toISOString();
  const run: Run = {
    id: newId("run"),
    createdAt: now,
    updatedAt: now,
    status: "sourcing",
    variant,
    order,
    vendors: loadVendors().map((v) => ({ vendorId: v.id, name: v.name, sourceType: v.sourceType, distanceMiles: null, isDemo: v.demo, stage: "searching" as VendorStage })),
    discovery: null,
    callScript: defaultScript(order),
    quotes: [],
    calls: [],
    evaluations: [],
    recommendation: null,
    selection: null,
    payment: null,
    restaurantConfirmation: null,
    audit: [],
    metrics: { startedAt: now },
  };
  saveRun(run);
  void runPipeline(run.id);
  return run;
}

async function runPipeline(runId: string) {
  const run = getRun(runId)!;
  const o = run.order;
  try {
    audit(runId, {
      action: "Order request created",
      actor: "user",
      raw: o,
      humanApproval: { required: true, granted: true, by: "requester", at: run.createdAt },
    });
    audit(runId, {
      action: `Hard constraints extracted: ${o.headcount} meals, $${o.budget} budget, ${fmtTime(o.deliveryDeadline)} deadline, ${o.vegetarianQty} vegetarian, ${o.veganQty} vegan${o.allergies.length ? `; allergy: no ${o.allergies.join(", ")} (must be confirmed)` : ""}`,
      actor: "agent",
      raw: { hard: { headcount: o.headcount, budget: o.budget, deadline: o.deliveryDeadline, vegetarianQty: o.vegetarianQty, veganQty: o.veganQty }, allergies: o.allergies, soft: ["lower price", "shorter delivery", "menu variety", "dietary confidence", "quote completeness", "source reliability", "lower delivery fee"], preferences: o.foodPreferences },
      confidence: 1,
      evidence: { kind: "user_provided", label: o.rawText ? "Free-text request + order form" : "Order form", quote: o.rawText },
    });
    audit(runId, {
      action: `Experiment variant ${run.variant === "A_online_only" ? "A: online data only" : "B: online data + phone calls"}`,
      actor: "system",
      decisionAffected: "Whether vendors without online menus are called",
    });
    await trackExposure(runId, run.variant).catch(() => undefined);
    await metric(run, "order_request_created", { headcount: o.headcount, budget: o.budget });

    const seeded = await seedSenso();
    for (const s of seeded.filter((x) => !x.skipped)) {
      audit(runId, {
        action: `Knowledge base: stored ${s.doc.title}`,
        actor: "senso",
        evidence: { kind: "menu_document", label: s.doc.title, ref: `senso:${s.doc.contentId}` },
        raw: s.doc,
      });
    }

    const inRange = await discoverVendors(runId);

    await Promise.all(
      inRange.map((v) =>
        (v.sourceType === "catalog" ? sourceCatalogVendor(runId, v) : sourcePhoneVendor(runId, v)).catch((e) => {
          setStage(runId, v.id, "failed", String(e?.message ?? e));
          audit(runId, { action: `${v.name}: sourcing failed`, actor: "system", raw: { error: String(e?.message ?? e) }, decisionAffected: `${v.name} excluded from comparison` });
        }),
      ),
    );
    maybeEvaluate(runId);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    updateRun(runId, (r) => {
      r.status = "error";
      r.error = msg;
    });
    audit(runId, { action: "Run failed", actor: "system", raw: { error: msg } });
  }
}

// ----------------------------------------------------------- discovery

/** Locate the venue, search real restaurants nearby, pin chains to real branches. Returns vendors to quote. */
async function discoverVendors(runId: string): Promise<Vendor[]> {
  const o = getRun(runId)!.order;
  const venue = { display: o.deliveryAddress, source: "openai_web_search" };
  updateRun(runId, (r) => {
    r.discovery = { venue, candidates: [], searching: true, startedAt: new Date().toISOString() };
  });
  audit(runId, { action: `Searching the web for restaurants near ${venue.display}`, actor: "openai" });

  const vendors = loadVendors();
  const chainNames = vendors.filter((v) => !v.demo).map((v) => v.name);
  const { candidates, branches, cachedAt } = await discoverAll(o.deliveryAddress, o, chainNames);
  if (cachedAt) {
    audit(runId, { action: `Restaurant search results from ${new Date(cachedAt).toLocaleTimeString()}`, actor: "system" });
  }
  const toQuote: Vendor[] = [];

  for (const v of vendors) {
    if (v.demo) {
      updateRun(runId, (r) => {
        const vs = r.vendors.find((x) => x.vendorId === v.id)!;
        vs.address = v.address;
        vs.distanceMiles = v.distanceMiles;
        vs.isDemo = true;
      });
      audit(runId, {
        action: `${v.name} found: neighborhood restaurant with no online menu`,
        actor: "system",
        evidence: { kind: "user_provided", label: "Restaurant directory listing" },
      });
      toQuote.push(v);
      continue;
    }
    const branch = branches[v.name] ?? null;
    if (!branch) {
      setStage(runId, v.id, "skipped", `No ${v.name} location found near the venue`);
      audit(runId, { action: `${v.name} excluded: no branch found near venue`, actor: "agent", evidence: { kind: "computed", label: "Web search" }, decisionAffected: `${v.name} not compared` });
      continue;
    }
    updateRun(runId, (r) => {
      const vs = r.vendors.find((x) => x.vendorId === v.id)!;
      vs.address = branch.address;
      vs.distanceMiles = branch.distanceMiles;
      vs.locationRef = branch.sourceRef;
    });
    if (branch.distanceMiles > o.maxRadiusMiles) {
      setStage(runId, v.id, "skipped", `Nearest branch is ${branch.distanceMiles} mi away, outside your ${o.maxRadiusMiles} mi radius`);
      audit(runId, { action: `${v.name} excluded: nearest branch ${branch.distanceMiles} mi exceeds ${o.maxRadiusMiles} mi radius`, actor: "agent", evidence: { kind: "computed", label: branch.name, ref: branch.sourceRef, quote: branch.address }, decisionAffected: `${v.name} not compared` });
      continue;
    }
    audit(runId, {
      action: `${v.name} matched to nearest branch: ${branch.address} (${branch.distanceMiles} mi)`,
      actor: "agent",
      evidence: { kind: "computed", label: "Web listing", ref: branch.sourceRef, quote: branch.address },
      raw: branch,
    });
    toQuote.push(v);
  }

  const others = candidates.filter((c) => !vendors.some((v) => !v.demo && c.name.toLowerCase().includes(v.name.toLowerCase())));
  updateRun(runId, (r) => {
    r.discovery = { venue, candidates, searching: false };
  });
  audit(runId, {
    action: `Restaurant search: ${candidates.length} restaurants within ${o.maxRadiusMiles} mi; top fits: ${others.slice(0, 3).map((c) => `${c.name} (${c.fitScore})`).join(", ") || "none"}`,
    actor: "agent",
    evidence: { kind: "computed", label: "Web search" },
    raw: candidates.slice(0, 25),
    decisionAffected: "Candidate vendors",
  });
  if (others.length) {
    audit(runId, {
      action: `${others.length} other nearby restaurants have no machine-readable menu; they can be called from the dashboard`,
      actor: "agent",
      decisionAffected: "Optional phone outreach",
    });
  }
  return toQuote;
}

// --------------------------------------------------------- catalog vendors

async function sensoEvidence(runId: string, v: Vendor, query: string) {
  const res = await searchVendor(v.id, query);
  audit(runId, {
    action: `Knowledge base query for ${v.name}: "${query}"`,
    actor: "senso",
    evidence: res.results[0]
      ? { kind: "menu_document", label: res.results[0].title, ref: `senso:${res.results[0].content_id}`, quote: res.results[0].chunk_text.slice(0, 280) }
      : null,
    confidence: res.results[0]?.score ?? null,
    raw: { answer: res.answer, results: res.results.map((r) => ({ title: r.title, content_id: r.content_id, score: r.score, chunk_text: r.chunk_text })) },
  });
  return res;
}

async function sourceCatalogVendor(runId: string, v: Vendor) {
  const run = getRun(runId)!;
  const o = run.order;
  const allergy = o.allergies[0] ?? null;

  const searches = await Promise.all([
    sensoEvidence(runId, v, `Which ${v.name} catering items are vegetarian?`),
    sensoEvidence(runId, v, `Which ${v.name} catering items are vegan?`),
    sensoEvidence(runId, v, allergy ? `What is ${v.name}'s ${allergy} allergen policy?` : `What is ${v.name}'s allergen policy?`),
  ]);
  setStage(runId, v.id, "menu_found");
  const chunks = [...new Set(searches.flatMap((s) => s.results.map((r) => r.chunk_text)))];
  const contentRef = searches.flatMap((s) => s.results)[0]?.content_id;

  const d = await classifyDietary({ vendorName: v.name, allergy, chunks });
  const toFinding = (f: (typeof d)["vegan"]): DietaryFinding => ({
    status: f.status,
    rawAnswer: f.rawAnswer,
    evidence: f.verified ? { kind: "menu_document", label: `${v.name} policy document`, ref: contentRef ? `senso:${contentRef}` : undefined, quote: f.rawAnswer } : null,
  });
  audit(runId, {
    action: `${v.name}: dietary evidence classified (vegetarian ${d.vegetarian.status}, vegan ${d.vegan.status}${allergy ? `, ${allergy} ${d.allergen.status}` : ""})`,
    actor: "openai",
    evidence: { kind: "menu_document", label: `${v.name} policy documents`, ref: contentRef ? `senso:${contentRef}` : undefined },
    confidence: [d.vegetarian, d.vegan, d.allergen].every((x) => x.verified) ? 0.9 : 0.6,
    raw: d,
    decisionAffected: "Dietary hard requirements and allergen warning",
  });

  const quote = buildCatalogQuote(v, o, {
    vegetarian: toFinding(d.vegetarian),
    vegan: toFinding(d.vegan),
    allergen: allergy ? { ...toFinding(d.allergen), allergy } : null,
  });
  updateRun(runId, (r) => {
    r.quotes.push(quote);
    const vs = r.vendors.find((x) => x.vendorId === v.id)!;
    vs.quoteId = quote.id;
  });
  audit(runId, {
    action: `${v.name} catalog loaded: ${quote.items.map((i) => `${i.quantity}× ${i.name}${i.unitPrice !== null ? ` @ $${i.unitPrice.toFixed(2)}` : " (no price)"}`).join("; ")}`,
    actor: "agent",
    evidence: { kind: "catalog_url", label: `${v.name} catalog snapshot (${v.catalog!.snapshotDate})`, ref: v.catalog!.sourceUrl },
    confidence: quote.quoteConfidence,
    raw: quote,
  });
  setStage(runId, v.id, "quote_extracted");
  setStage(runId, v.id, "ready");
}

// ----------------------------------------------------------- phone vendors

async function sourcePhoneVendor(runId: string, v: Vendor) {
  const run = getRun(runId)!;
  const res = await sensoEvidence(runId, v, `Does ${v.name} publish an online menu with catering prices?`);
  setStage(runId, v.id, "no_menu");
  audit(runId, {
    action: `No reliable online menu found for ${v.name}`,
    actor: "agent",
    evidence: res.results[0] ? { kind: "menu_document", label: res.results[0].title, ref: `senso:${res.results[0].content_id}`, quote: res.answer.slice(0, 280) } : null,
    decisionAffected: `${v.name} can only be quoted by phone`,
  });

  if (run.variant === "A_online_only") {
    setStage(runId, v.id, "skipped", "Experiment variant A uses online data only");
    audit(runId, { action: `${v.name} skipped: variant A does not place calls`, actor: "system", decisionAffected: `${v.name} not compared` });
    return;
  }
  if (run.order.permissionToCall) {
    audit(runId, {
      action: "User-approved phone call",
      actor: "user",
      humanApproval: { required: true, granted: true, by: "requester (order form: permission to call restaurants)", at: run.createdAt },
      decisionAffected: `OpenBid may call ${v.name}`,
    });
    await startPhoneQuote(runId, v.id);
  } else {
    setStage(runId, v.id, "awaiting_call_approval", "Waiting for you to approve the call");
    updateRun(runId, (r) => {
      r.status = "awaiting_call_approval";
    });
    audit(runId, {
      action: `Approval needed to call ${v.name}`,
      actor: "agent",
      humanApproval: { required: true },
      decisionAffected: `${v.name} cannot be quoted without a call`,
    });
  }
}

export function approveCall(runId: string, vendorId: string) {
  const run = getRun(runId);
  if (!run) throw new Error("run not found");
  const vs = run.vendors.find((v) => v.vendorId === vendorId);
  if (!vs || vs.stage !== "awaiting_call_approval") throw new Error("This vendor is not waiting for call approval");
  updateRun(runId, (r) => {
    r.status = "sourcing";
  });
  audit(runId, {
    action: "User-approved phone call",
    actor: "user",
    humanApproval: { required: true, granted: true, by: "requester (dashboard)", at: new Date().toISOString() },
    decisionAffected: `OpenBid may call ${vs.name}`,
  });
  return startPhoneQuote(runId, vendorId);
}

export function declineCall(runId: string, vendorId: string) {
  setStage(runId, vendorId, "skipped", "You declined the call");
  updateRun(runId, (r) => {
    r.status = "sourcing";
  });
  audit(runId, { action: `User declined call to ${getRun(runId)!.vendors.find((v) => v.vendorId === vendorId)?.name ?? vendorId}`, actor: "user", humanApproval: { required: true, granted: false, at: new Date().toISOString() } });
  maybeEvaluate(runId);
}

function callHooks(runId: string, callId: string, vendor: PhoneVendor, onDone: (call: CallRecord) => void, trackStages: boolean): CallHooks {
  const patch = (fn: (c: CallRecord) => void) =>
    updateRun(runId, (r) => {
      const c = r.calls.find((x) => x.id === callId);
      if (c) fn(c);
    });
  const seen = new Set<string>();
  return {
    onDialing(guavaCallId) {
      const inbound = Boolean(getRun(runId)!.calls.find((c) => c.id === callId)?.dialIn);
      patch((c) => {
        c.guavaCallId = guavaCallId;
        if (inbound) c.stageLabel = `${vendor.name} called in`;
      });
      audit(runId, { action: inbound ? `${vendor.name} called in; agent answered` : `Call started to ${vendor.name}`, actor: "guava", evidence: { kind: "phone_transcript", label: "Phone call", ref: guavaCallId ?? undefined } });
    },
    onAwaitingInbound(dialIn, reason) {
      patch((c) => {
        c.direction = "inbound";
        c.dialIn = dialIn;
        c.guavaCallId = null;
        c.stageLabel = `Waiting for ${vendor.name} to call ${dialIn}`;
      });
      audit(runId, {
        action: `Outbound call unavailable: waiting for ${vendor.name} to call the agent at ${dialIn}`,
        actor: "guava",
        raw: { reason },
        decisionAffected: "Quote is collected when the restaurant dials in",
      });
    },
    onTranscript(line) {
      patch((c) => {
        c.status = "in_progress";
        c.transcript.push(line);
      });
    },
    onFields(fields) {
      patch((c) => {
        c.fields = fields;
      });
      for (const [k, val] of Object.entries(fields)) {
        if (seen.has(k)) continue;
        seen.add(k);
        const run = getRun(runId)!;
        const action =
          k === "can_prepare_count" && String(val).toLowerCase() === "yes"
            ? `${vendor.name} confirmed ${run.order.headcount} meals`
            : k === "order_confirmed"
              ? `${vendor.name} answered order confirmation: ${val}`
              : `${vendor.name} answered ${k.replace(/_/g, " ")}: "${String(val)}"`;
        audit(runId, { action, actor: "restaurant", evidence: { kind: "phone_transcript", label: `Call answer: ${k.replace(/_/g, " ")}`, ref: run.calls.find((c) => c.id === callId)?.guavaCallId ?? undefined, quote: String(val) }, raw: { field: k, value: val } });
      }
    },
    onStage(stage, label) {
      patch((c) => {
        c.stageLabel = label;
      });
      if (trackStages) setStage(runId, vendor.id, stage);
    },
    onEnd(result) {
      patch((c) => {
        c.status = result.status;
        c.fields = result.fields;
        c.guavaCallId = result.guavaCallId ?? c.guavaCallId;
        c.terminationReason = result.terminationReason;
        c.error = result.error;
        c.endedAt = new Date().toISOString();
        if (result.status === "failed") c.stageLabel = "Call failed";
      });
      audit(runId, {
        action: result.status === "completed" ? `Call with ${vendor.name} ended (${result.terminationReason ?? "ended"})` : `Call to ${vendor.name} failed: ${result.error}`,
        actor: "guava",
        evidence: { kind: "phone_transcript", label: "Phone call", ref: result.guavaCallId ?? undefined },
        raw: result,
      });
      const c = getRun(runId)!.calls.find((x) => x.id === callId)!;
      onDone(c);
    },
  };
}

export type PhoneVendor = { id: string; name: string };

function phoneFor(vs: { isDemo?: boolean; phone?: string; name: string }) {
  if (vs.isDemo) return requireEnv("DEMO_RESTAURANT_PHONE");
  if (!vs.phone) throw new Error(`No phone number on file for ${vs.name}`);
  return vs.phone;
}

async function startPhoneQuote(runId: string, vendorId: string) {
  const vs0 = getRun(runId)!.vendors.find((x) => x.vendorId === vendorId)!;
  const v: PhoneVendor = { id: vendorId, name: vs0.name };
  const toNumber = phoneFor(vs0);
  const callId = newId("call");
  const call: CallRecord = {
    id: callId,
    guavaCallId: null,
    vendorId,
    purpose: "quote",
    toNumber,
    status: "dialing",
    stageLabel: `Calling ${v.name}…`,
    transcript: [],
    fields: {},
    startedAt: new Date().toISOString(),
  };
  updateRun(runId, (r) => {
    r.calls.push(call);
    const vs = r.vendors.find((x) => x.vendorId === vendorId)!;
    vs.stage = "calling";
    vs.callId = callId;
    vs.note = undefined;
  });
  const run = getRun(runId)!;
  startQuoteCall({
    toNumber,
    vendorName: v.name,
    order: run.order,
    script: run.callScript ?? defaultScript(run.order),
    hooks: callHooks(
      runId,
      callId,
      v,
      (c) => {
        if (c.status === "failed" || c.transcript.length === 0) {
          setStage(runId, vendorId, "failed", c.error ?? "Call ended without a conversation");
          maybeEvaluate(runId);
          return;
        }
        finalizePhoneQuote(runId, v, c)
          .catch((e) => {
            setStage(runId, vendorId, "failed", `Quote extraction failed: ${String(e?.message ?? e)}`);
            audit(runId, { action: `${v.name}: quote extraction failed`, actor: "system", raw: { error: String(e?.message ?? e) } });
          })
          .finally(() => maybeEvaluate(runId));
      },
      true,
    ),
  });
}

function parseClock(raw: string, onDate: Date): Date | null {
  const text = /\bnoon\b/i.test(raw) ? "12:00 pm" : numberWordsToDigits(raw);
  const m = text.match(/\b(\d{1,2})(?:[:.\s](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h < 7) h += 12; // "1:15" for a lunch order means 1:15 PM
  if (h > 23 || min > 59) return null;
  const d = new Date(onDate);
  d.setHours(h, min, 0, 0);
  return d;
}

const TYPED_STATUS = (v: unknown): DietaryFinding["status"] => {
  const s = String(v ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.startsWith("yes")) return "confirmed";
  if (s === "no") return "not_available";
  return "uncertain";
};

/**
 * Transcript + typed call answers → normalized quote. Every price must be
 * backed by the restaurant's own words (verbatim, number present) or it is
 * dropped. Shared by live calls and the Firedrill simulations.
 */
export async function buildPhoneQuote(args: {
  vendor: PhoneVendor;
  order: OrderRequest;
  call: Pick<CallRecord, "id" | "guavaCallId" | "transcript" | "fields">;
  script?: ScriptQuestion[];
}) {
  const { vendor: v, order: o, call } = args;
  const allergy = o.allergies[0] ?? null;
  const transcriptText = call.transcript.map((l) => `${l.speaker}: ${l.text}`).join("\n");
  const restaurantSaid = [...call.transcript.filter((l) => l.speaker === "RESTAURANT").map((l) => l.text), ...Object.values(call.fields).map(String)];
  const confirmed = String(call.fields.quote_confirmed ?? "").toLowerCase() === "yes";

  const ex = await extractPhoneQuote({
    vendorName: v.name,
    transcript: transcriptText,
    fields: call.fields,
    order: { headcount: o.headcount, vegetarianQty: o.vegetarianQty, veganQty: o.veganQty, allergy },
    nowLocal: new Date().toString(),
  });

  const rejected: string[] = [];
  const cite = (quote: string): Evidence => ({
    kind: confirmed ? "restaurant_confirmation" : "phone_transcript",
    label: `Live phone quote: ${v.name}${confirmed ? " (read back and confirmed)" : ""}`,
    ref: call.guavaCallId ? `guava:${call.guavaCallId}` : call.id,
    quote,
  });
  const verifiedNumber = (value: number | null, rawEvidence: string, zeroWords = /free|no (delivery )?fee|none|no minimum|zero/i) => {
    if (value === null) return false;
    // The model sometimes copies the transcript's speaker label. The agent's own words never count as a source.
    if (/^\s*AGENT\s*:/i.test(rawEvidence)) return false;
    const evidence = rawEvidence.replace(/^\s*RESTAURANT\s*:\s*/i, "");
    if (!appearsIn(evidence, restaurantSaid)) return false;
    if (value === 0 && zeroWords.test(evidence)) return true;
    return numberIn(value, evidence) || spokenNumbers(evidence).some((n) => Math.abs(n - value) < 0.005);
  };

  const standardQty = o.headcount - o.vegetarianQty - o.veganQty;
  const qtyFor = { standard: standardQty, vegetarian: o.vegetarianQty, vegan: o.veganQty };
  const items: QuoteItem[] = [];
  const missing: string[] = [];
  for (const cat of ["standard", "vegetarian", "vegan"] as const) {
    if (qtyFor[cat] <= 0) continue;
    const it = ex.items.find((i) => i.category === cat);
    if (!it) {
      missing.push(`${cat} meal price`);
      items.push({ name: `No ${cat} meal quoted`, category: cat, quantity: qtyFor[cat], unitPrice: null, evidence: null });
      continue;
    }
    if (verifiedNumber(it.unitPrice, it.evidence)) {
      items.push({ name: it.name, category: cat, quantity: qtyFor[cat], unitPrice: it.unitPrice, evidence: cite(it.evidence) });
    } else {
      rejected.push(`${cat} price ${it.unitPrice ?? "null"} ("${it.evidence}")`);
      missing.push(`${cat} meal price`);
      items.push({ name: it.name, category: cat, quantity: qtyFor[cat], unitPrice: null, evidence: null });
    }
  }

  const feeOk = verifiedNumber(ex.deliveryFee.value, ex.deliveryFee.evidence);
  if (!feeOk) missing.push("delivery fee");
  const minOk = verifiedNumber(ex.minimumOrder.value, ex.minimumOrder.evidence);

  const deadline = new Date(o.deliveryDeadline);
  const timeSrc = typeof call.fields.delivery_time === "string" ? call.fields.delivery_time : ex.deliveryTime24h.value ?? "";
  let promise = timeSrc ? parseClock(timeSrc, deadline) : null;
  if (!promise && ex.deliveryTime24h.value && appearsIn(ex.deliveryTime24h.evidence, restaurantSaid)) {
    promise = parseClock(ex.deliveryTime24h.value, deadline);
  }
  if (!promise) missing.push("delivery time");

  const finding = (typedKey: string, f: { status: DietaryFinding["status"]; rawAnswer: string }, rawKey?: string): DietaryFinding => {
    const typed = call.fields[typedKey];
    const raw = (rawKey && typeof call.fields[rawKey] === "string" ? (call.fields[rawKey] as string) : "") || f.rawAnswer || String(typed ?? "");
    const verified = raw ? appearsIn(raw, restaurantSaid) : false;
    const status = typed !== undefined ? TYPED_STATUS(typed) : verified ? f.status : "unknown";
    return { status, rawAnswer: raw, evidence: verified ? cite(raw) : null };
  };

  const validMin = ex.quoteValidMinutesFromNow;
  const quote: Quote = {
    id: newId("q"),
    vendorId: v.id,
    vendorName: v.name,
    sourceType: "phone",
    items,
    subtotal: null,
    deliveryFee: feeOk ? ex.deliveryFee.value : null,
    deliveryFeeEvidence: feeOk ? cite(ex.deliveryFee.evidence) : null,
    taxRate: o.taxRate,
    taxEstimate: null,
    total: null,
    minimumOrder: minOk ? ex.minimumOrder.value : null,
    minimumOrderEvidence: minOk ? cite(ex.minimumOrder.evidence) : null,
    canFulfillCount: call.fields.can_prepare_count !== undefined ? TYPED_STATUS(call.fields.can_prepare_count) : ex.canFulfillCount,
    deliveryPromise: promise ? promise.toISOString() : null,
    deliveryPromiseEvidence: promise ? cite(timeSrc) : null,
    vegetarian: finding("vegetarian_available", ex.vegetarian),
    vegan: finding("vegan_available", ex.vegan),
    allergen: allergy ? { ...finding("allergen_policy", ex.allergen, "allergen_details"), allergy } : null,
    quoteConfidence: 0,
    quoteValidUntil: validMin !== null ? new Date(Date.now() + validMin * 60_000).toISOString() : null,
    quoteValidRaw: (call.fields.quote_valid as string) ?? ex.quoteValidRaw,
    missingFields: [...new Set(missing)],
    extraAnswers: (args.script ?? [])
      .filter((q) => !q.builtin && call.fields[q.key] !== undefined)
      .map((q) => ({ question: q.question, answer: String(call.fields[q.key]) })),
    createdAt: new Date().toISOString(),
  };
  computeTotals(quote);
  quote.quoteConfidence = quoteConfidence(quote);
  return { quote, extraction: ex, rejected, transcriptText, cite };
}

async function finalizePhoneQuote(runId: string, v: PhoneVendor, call: CallRecord) {
  const run = getRun(runId)!;
  const { quote, extraction: ex, rejected, transcriptText, cite } = await buildPhoneQuote({ vendor: v, order: run.order, call, script: run.callScript });

  updateRun(runId, (r) => {
    r.quotes.push(quote);
    const vs = r.vendors.find((x) => x.vendorId === v.id)!;
    vs.quoteId = quote.id;
    vs.stage = "quote_extracted";
  });
  audit(runId, {
    action: `Quote extracted from transcript: ${quote.items.map((i) => `${i.quantity}× ${i.name}${i.unitPrice !== null ? ` @ $${i.unitPrice.toFixed(2)}` : " (unverified)"}`).join("; ")}${quote.total !== null ? `; total $${quote.total.toFixed(2)}` : ""}`,
    actor: "openai",
    evidence: cite(transcriptText.slice(0, 400)),
    confidence: quote.quoteConfidence,
    raw: { extraction: ex, verifiedQuote: quote, rejectedValues: rejected },
    decisionAffected: rejected.length ? `Rejected unsourced values: ${rejected.join("; ")}` : "All prices verified against restaurant's own words",
  });
  setStage(runId, v.id, "ready");

  ingestTranscript(v.id, v.name, `# ${v.name} phone quote (${new Date().toLocaleString()})\n\nCall ${call.guavaCallId}\n\n${transcriptText}\n\n## Typed fields\n${Object.entries(call.fields).map(([k, val]) => `- ${k}: ${String(val)}`).join("\n")}`)
    .then((doc) => audit(runId, { action: `Knowledge base: stored ${v.name} call transcript`, actor: "senso", evidence: { kind: "phone_transcript", label: doc.title, ref: `senso:${doc.contentId}` } }))
    .catch((e) => audit(runId, { action: `Knowledge base: transcript storage failed`, actor: "senso", raw: { error: String(e?.message ?? e) } }));
}

// ------------------------------------------------------- call script & candidates

export function updateScript(runId: string, items: ScriptQuestion[]) {
  const run = getRun(runId);
  if (!run) throw new Error("run not found");
  const script = sanitizeScript(items, run.callScript ?? defaultScript(run.order));
  updateRun(runId, (r) => {
    r.callScript = script;
  });
  const custom = script.filter((q) => !q.builtin);
  audit(runId, {
    action: `Call questions updated: ${script.filter((q) => q.enabled).length} questions${custom.length ? `, including custom: ${custom.map((q) => `"${q.question}"`).join(", ")}` : ""}`,
    actor: "user",
  });
  return script;
}

function toE164(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error(`Can't dial "${phone}"`);
}

/** Add a restaurant found by web search as a phone vendor and call it. */
export async function callCandidate(runId: string, candidateId: string) {
  const run = getRun(runId);
  if (!run) throw new Error("run not found");
  if (run.payment) throw new Error("This order is already at checkout");
  const c = run.discovery?.candidates.find((x) => x.id === candidateId);
  if (!c) throw new Error("Unknown restaurant");
  if (!c.phone) throw new Error(`No phone number listed for ${c.name}`);
  if (run.vendors.some((v) => v.vendorId === candidateId)) throw new Error(`${c.name} has already been contacted`);
  const phone = toE164(c.phone);
  updateRun(runId, (r) => {
    r.vendors.push({ vendorId: c.id, name: c.name, sourceType: "phone", distanceMiles: c.distanceMiles, address: c.address, locationRef: c.sourceRef, phone, stage: "searching" });
    r.status = "sourcing";
  });
  audit(runId, {
    action: `User-approved phone call to ${c.name} (${phone})`,
    actor: "user",
    evidence: { kind: "computed", label: "Web listing", ref: c.sourceRef, quote: `${c.address} · ${c.phone}` },
    humanApproval: { required: true, granted: true, by: "requester (dashboard)", at: new Date().toISOString() },
    decisionAffected: `${c.name} added to the comparison`,
  });
  return startPhoneQuote(runId, c.id);
}

// -------------------------------------------------------------- evaluation

function maybeEvaluate(runId: string) {
  let shouldRun = false;
  updateRun(runId, (r) => {
    const allDone = r.vendors.every((v) => TERMINAL.includes(v.stage));
    if (allDone && (r.status === "sourcing" || r.status === "awaiting_call_approval")) {
      r.status = "comparing";
      shouldRun = true;
    }
  });
  if (!shouldRun) return;

  const run = getRun(runId)!;
  for (const q of run.quotes) setStage(runId, q.vendorId, "checking_constraints");
  const evaluations = evaluateAll(run.quotes, run.order);
  const rec = recommend(run.quotes, evaluations);
  const now = new Date().toISOString();
  updateRun(runId, (r) => {
    r.evaluations = evaluations;
    r.recommendation = rec;
    r.status = "awaiting_selection";
    r.metrics.quotesCompletedAt = now;
    for (const q of r.quotes) {
      const vs = r.vendors.find((v) => v.vendorId === q.vendorId)!;
      vs.stage = "ready";
    }
  });
  for (const e of evaluations) {
    const q = run.quotes.find((x) => x.vendorId === e.vendorId)!;
    if (!e.eligible) {
      const fail = e.checks.find((c) => c.hard && c.passed !== true)!;
      audit(runId, {
        action: `${q.vendorName} rejected: ${fail.label.toLowerCase()} not met (${fail.detail})`,
        actor: "agent",
        evidence: q.items[0]?.evidence ?? null,
        confidence: q.quoteConfidence,
        raw: e,
        decisionAffected: `${q.vendorName} cannot win`,
      });
    }
  }
  if (rec.vendorId) {
    const q = run.quotes.find((x) => x.vendorId === rec.vendorId)!;
    audit(runId, {
      action: `${q.vendorName} selected as best fit`,
      actor: "agent",
      confidence: rec.decisionConfidence,
      raw: { recommendation: rec, evaluation: evaluations.find((e) => e.vendorId === rec.vendorId) },
      decisionAffected: "Recommended vendor",
      humanApproval: { required: true },
    });
  } else {
    audit(runId, { action: "No vendor meets every hard requirement", actor: "agent", raw: rec });
  }
  void historyEvidence(runId);
  const viable = evaluations.filter((e) => e.eligible).length;
  void metric(run, "quotes_compared", {
    viable_vendors: viable,
    vendors_quoted: run.quotes.length,
    time_to_complete_quote_ms: Date.parse(now) - Date.parse(run.metrics.startedAt),
    missing_fields: run.quotes.reduce((s, q) => s + q.missingFields.length, 0),
    decision_confidence: rec.decisionConfidence,
    calls_placed: run.calls.filter((c) => c.purpose === "quote").length,
  });
}

/** Past quotes for these vendors and similar past orders, from the order database. Context only; never changes a price. */
async function historyEvidence(runId: string) {
  if (!singlestoreEnabled()) return;
  const run = getRun(runId)!;
  try {
    const hist = await vendorHistory(run.quotes.map((q) => q.vendorId), runId);
    if (hist.length) {
      audit(runId, {
        action: `Order history: ${hist.map((h) => `${h.vendorName} quoted ${h.pastQuotes}× before (avg $${h.avgTotal?.toFixed(2) ?? "n/a"}, chosen ${h.timesChosen}×)`).join("; ")}`,
        actor: "agent",
        evidence: { kind: "computed", label: "Order history database" },
        raw: hist,
        decisionAffected: "Context for your decision (does not change scores)",
      });
    }
    const o = run.order;
    const similar = await semanticSearch(`Catering for ${o.headcount} people, ${o.vegetarianQty} vegetarian, ${o.veganQty} vegan, no ${o.allergies.join(", ") || "allergens"}, budget $${o.budget}, near ${o.deliveryAddress}`, { excludeRunId: runId, limit: 3 });
    if (similar.length) {
      audit(runId, {
        action: `Similar past orders: ${similar.map((s) => `${s.vendorName} $${s.total?.toFixed(2) ?? "n/a"} (match ${s.score})`).join("; ")}`,
        actor: "agent",
        evidence: { kind: "computed", label: "Order history (vector search)", quote: similar[0].summary.slice(0, 240) },
        raw: similar,
        decisionAffected: "Context for your decision (does not change scores)",
      });
    }
  } catch (e) {
    audit(runId, { action: "Order history lookup failed", actor: "system", raw: { error: String((e as Error)?.message ?? e) } });
  }
}

// ------------------------------------------------------- approval & payment

export async function selectVendor(runId: string, vendorId: string, allergenAcknowledged: boolean, override = false) {
  const run = getRun(runId);
  if (!run) throw new Error("run not found");
  if (run.payment?.status === "paid") throw new Error("This order is already paid");
  const e = run.evaluations.find((x) => x.vendorId === vendorId);
  const q = run.quotes.find((x) => x.vendorId === vendorId);
  if (!e || !q) throw new Error("No quote for that vendor");
  const failed = e.checks.filter((c) => c.hard && c.passed !== true);
  if (q.total === null) throw new Error(`${q.vendorName}'s quote is incomplete (${q.missingFields.join(", ")}), so it can't be paid`);
  if (!e.eligible && !override) throw new Error(`${q.vendorName} fails: ${failed.map((c) => c.label).join(", ")}. Confirm the override to order anyway.`);
  if (e.requiresAllergenAck && !allergenAcknowledged) throw new Error("You must acknowledge the allergen warning before ordering");
  const at = new Date().toISOString();
  updateRun(runId, (r) => {
    r.selection = { vendorId, quoteId: q.id, allergenAcknowledged, approvedAt: at };
  });
  if (!e.eligible) {
    audit(runId, {
      action: `User overrode failed requirement(s) for ${q.vendorName}: ${failed.map((c) => `${c.label} (${c.detail})`).join("; ")}`,
      actor: "user",
      humanApproval: { required: true, granted: true, by: "requester (explicit override)", at: new Date().toISOString() },
      decisionAffected: "Hard requirements waived by the requester",
    });
  }
  audit(runId, {
    action: `User approved order from ${q.vendorName} ($${q.total!.toFixed(2)})`,
    actor: "user",
    humanApproval: { required: true, granted: true, by: "requester", at },
    raw: { quoteId: q.id, allergenAcknowledged, warnings: e.warnings },
    decisionAffected: "Proceed to payment",
  });
  void metric(run, "user_approved", { vendor_id: vendorId, recommended: run.recommendation?.vendorId === vendorId, total: q.total });

  if (personaEnabled() && !run.buyerVerification?.verified) {
    const base = getEnv("APP_BASE_URL") ?? "http://localhost:3000";
    const inq = await createInquiry(runId);
    updateRun(runId, (r) => {
      r.buyerVerification = { provider: "persona", inquiryId: inq.inquiryId, status: inq.status, verified: false };
    });
    audit(runId, {
      action: "Buyer identity verification requested before payment",
      actor: "system",
      evidence: { kind: "computed", label: "Identity verification inquiry", ref: inq.inquiryId },
      humanApproval: { required: true },
      decisionAffected: "Payment unlocks only after a verified human approves",
    });
    return hostedFlowUrl(inq.inquiryId, `${base}/runs/${runId}/checkout?verify=1`);
  }
  return startCheckout(runId);
}

/** Called when the buyer returns from the hosted identity flow. */
export async function completeVerification(runId: string): Promise<{ verified: boolean; status: string; url?: string }> {
  const run = getRun(runId);
  if (!run?.buyerVerification) throw new Error("No verification in progress");
  if (run.payment) return { verified: true, status: run.buyerVerification.status, url: run.payment.url };
  const inq = await getInquiry(run.buyerVerification.inquiryId);
  updateRun(runId, (r) => {
    r.buyerVerification = { ...r.buyerVerification!, status: inq.status, verified: inq.verified, verifiedAt: inq.verified ? new Date().toISOString() : undefined };
  });
  if (!inq.verified) return { verified: false, status: inq.status };
  audit(runId, {
    action: "Buyer identity verified",
    actor: "user",
    evidence: { kind: "computed", label: "Identity verification inquiry", ref: inq.inquiryId, quote: inq.status },
    humanApproval: { required: true, granted: true, by: "verified buyer", at: new Date().toISOString() },
    decisionAffected: "Payment unlocked",
  });
  return { verified: true, status: inq.status, url: await startCheckout(runId) };
}

async function startCheckout(runId: string) {
  const run = getRun(runId)!;
  const q = run.quotes.find((x) => x.id === run.selection!.quoteId)!;
  const at = new Date().toISOString();
  const session = await createCheckout(run, q);
  updateRun(runId, (r) => {
    r.status = "awaiting_payment";
    r.payment = { stripeSessionId: session.id, url: session.url!, status: "created", amountTotal: (session.amount_total ?? 0) / 100, createdAt: at };
  });
  audit(runId, {
    action: "Checkout session created",
    actor: "stripe",
    evidence: { kind: "computed", label: "Checkout session", ref: session.id },
    raw: { id: session.id, amount_total: session.amount_total, metadata: session.metadata },
  });
  return session.url!;
}

export async function markPaid(runId: string, sessionId: string, via: "redirect" | "webhook") {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.metadata?.orderId !== runId) throw new Error("Session does not belong to this order");
  if (session.payment_status !== "paid") return { paid: false };

  let first = false;
  updateRun(runId, (r) => {
    if (r.payment && r.payment.status !== "paid") {
      r.payment.status = "paid";
      r.payment.paidAt = new Date().toISOString();
      r.payment.amountTotal = (session.amount_total ?? 0) / 100;
      r.status = "paid";
      first = true;
    }
  });
  if (!first) return { paid: true };
  const run = getRun(runId)!;
  audit(runId, {
    action: `Payment completed: $${((session.amount_total ?? 0) / 100).toFixed(2)}`,
    actor: "stripe",
    evidence: { kind: "computed", label: `Payment ${via === "webhook" ? "webhook" : "verified on return"}`, ref: session.payment_intent ? String(session.payment_intent) : session.id },
    raw: { session_id: session.id, payment_status: session.payment_status, metadata: session.metadata },
  });
  void metric(run, "order_completed", { total: (session.amount_total ?? 0) / 100, vendor_id: run.selection?.vendorId });
  startConfirmation(runId);
  return { paid: true };
}

function startConfirmation(runId: string) {
  const run = getRun(runId)!;
  const vs = run.vendors.find((x) => x.vendorId === run.selection!.vendorId)!;
  const v: PhoneVendor = { id: vs.vendorId, name: vs.name };
  const q = run.quotes.find((x) => x.id === run.selection!.quoteId)!;
  if (vs.sourceType !== "phone") {
    updateRun(runId, (r) => {
      r.restaurantConfirmation = { status: "not_applicable", detail: `${v.name} is a catalog vendor. Submit the order through its online catering channel.` };
    });
    audit(runId, { action: `${v.name}: confirmation call not applicable (catalog vendor)`, actor: "system" });
    return;
  }
  const toNumber = phoneFor(vs);
  const callId = newId("call");
  updateRun(runId, (r) => {
    r.status = "confirming";
    r.restaurantConfirmation = { status: "calling", detail: `Calling ${v.name} to confirm`, callId };
    r.calls.push({ id: callId, guavaCallId: null, vendorId: v.id, purpose: "confirmation", toNumber, status: "dialing", stageLabel: `Calling ${v.name}…`, transcript: [], fields: {}, startedAt: new Date().toISOString() });
  });
  audit(runId, { action: "Order confirmation call initiated", actor: "agent", decisionAffected: "Final order state" });
  startConfirmationCall({
    toNumber,
    vendorName: v.name,
    orderSummary: q.items.map((i) => `${i.quantity} ${i.name} at $${i.unitPrice?.toFixed(2)} each`).join(", "),
    deliveryAddress: run.order.deliveryAddress,
    deliveryTime: q.deliveryPromise ? fmtTime(q.deliveryPromise) : fmtTime(run.order.deliveryDeadline),
    total: `$${run.payment!.amountTotal.toFixed(2)}`,
    hooks: callHooks(runId, callId, v, (c) => {
      const ans = String(c.fields.order_confirmed ?? "").toLowerCase();
      const status = c.status === "failed" ? "failed" : ans === "yes" ? "confirmed" : ans === "no" ? "declined" : "failed";
      updateRun(runId, (r) => {
        r.status = status === "confirmed" ? "confirmed" : "confirmation_failed";
        r.restaurantConfirmation = {
          status,
          callId,
          detail:
            status === "confirmed"
              ? `Confirmed by ${v.name}${c.fields.confirmed_delivery_time ? `; arriving ${String(c.fields.confirmed_delivery_time)}` : ""}`
              : status === "declined"
                ? `${v.name} declined the order. Refund needed.`
                : `Could not confirm: ${c.error ?? "no confirmation captured"}`,
        };
      });
      audit(runId, {
        action: status === "confirmed" ? `${v.name} confirmed the order. Final state: confirmed` : `Order confirmation ${status}`,
        actor: "restaurant",
        evidence: { kind: "restaurant_confirmation", label: "Confirmation call", ref: c.guavaCallId ?? undefined, quote: String(c.fields.order_confirmed ?? "") },
        raw: c.fields,
      });
    }, false),
  });
}

export { STAGE_LABEL, round2, norm };
