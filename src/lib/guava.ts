import * as guava from "@guava-ai/guava-sdk";
import { getEnv, requireEnv } from "./env";
import type { OrderRequest, TranscriptLine, VendorStage } from "./types";
import type { ScriptQuestion } from "./questions";

// Guava outbound calls. The SDK keeps a WebSocket open to Guava's dialog
// system for the life of the call, so calls run inside this long-lived Node
// server process (next dev / next start), not in a serverless function.

export interface CallHooks {
  onDialing(guavaCallId: string | null): void;
  /** Outbound is unavailable: the agent is listening and the restaurant must dial in. */
  onAwaitingInbound(dialIn: string, reason: string): void;
  onTranscript(line: TranscriptLine): void;
  onFields(fields: Record<string, unknown>): void;
  onStage(stage: VendorStage, label: string): void;
  onEnd(result: {
    status: "completed" | "failed";
    guavaCallId: string | null;
    fields: Record<string, unknown>;
    terminationReason?: string;
    error?: string;
  }): void;
}

function makeAgent(purpose: string) {
  const apiKey = requireEnv("GUAVA_API_KEY");
  // The SDK's Agent builds its Client from process.env at construction time.
  process.env.GUAVA_API_KEY = apiKey;
  return new guava.Agent({ name: "Ava", organization: "OpenBid", purpose });
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

interface FieldDef {
  key: string;
  stage: VendorStage;
  field: ReturnType<typeof guava.Field>;
}

type Direction = "outbound" | "inbound";
type ChecklistItem = FieldDef | string | ReturnType<typeof guava.Say>;

/** GUAVA_CALL_MODE: outbound | inbound | auto (default: try outbound, fall back to inbound). */
export function callMode(): "outbound" | "inbound" | "auto" {
  const m = (getEnv("GUAVA_CALL_MODE") ?? "auto").toLowerCase();
  return m === "outbound" || m === "inbound" ? m : "auto";
}

const INBOUND_WAIT_MS = 10 * 60_000;

function runCall(args: {
  agent: guava.Agent;
  toNumber: string;
  taskId: string;
  checklist: (direction: Direction) => ChecklistItem[];
  hangupLine: string;
  hooks: CallHooks;
  variables?: Record<string, string>;
}) {
  const { agent, toNumber, taskId, hooks } = args;
  const from = requireEnv("GUAVA_AGENT_NUMBER");
  const fieldDefs = args.checklist("outbound").filter((c): c is FieldDef => typeof c === "object" && "stage" in c);
  const fields: Record<string, unknown> = {};
  let callId: string | null = null;
  let answered = false;
  let ended = false;
  let lastStage: VendorStage | null = null;
  let direction: Direction = callMode() === "inbound" ? "inbound" : "outbound";
  let inboundTaken = false;
  const listener = new AbortController();

  const collect = async (call: guava.Call) => {
    let changed = false;
    for (const d of fieldDefs) {
      if (d.key in fields) continue;
      const v = await call.getField(d.key);
      if (v !== null && v !== undefined) {
        fields[d.key] = v;
        changed = true;
      }
    }
    if (changed) {
      hooks.onFields({ ...fields });
      // Stage = the stage of the first field not yet collected.
      const next = fieldDefs.find((d) => !(d.key in fields));
      const stage = next ? next.stage : "repeating_quote";
      if (stage !== lastStage) {
        lastStage = stage;
        hooks.onStage(stage, STAGE_LABEL[stage] ?? stage);
      }
    }
  };

  const finish = (r: Parameters<CallHooks["onEnd"]>[0]) => {
    if (ended) return;
    ended = true;
    listener.abort(); // stop listening on the agent number once this call is done
    hooks.onEnd(r);
  };

  agent.onCallStart(async (call) => {
    callId = call.id;
    hooks.onDialing(callId);
    await call.setTask({
      taskId,
      checklist: args.checklist(direction).map((c) => (typeof c === "object" && "stage" in c ? c.field : c)),
    });
  });
  // Inbound: take exactly one call, then decline any others.
  agent.onCallReceived(async () => {
    if (inboundTaken) return { action: "decline" };
    inboundTaken = true;
    return { action: "accept" };
  });

  const listenInbound = (reason: string) => {
    direction = "inbound";
    hooks.onAwaitingInbound(from, reason);
    const noop = () => undefined;
    const healthCtx = { ready: noop, draining: noop, stopped: noop } as unknown as Parameters<guava.Agent["_listenInbound"]>[0];
    const timer = setTimeout(() => {
      if (!inboundTaken) finish({ status: "failed", guavaCallId: null, fields: { ...fields }, error: `No inbound call to ${from} within ${INBOUND_WAIT_MS / 60000} minutes` });
    }, INBOUND_WAIT_MS);
    agent
      ._listenInbound(healthCtx, { agent_number: from }, args.variables ?? {}, listener.signal)
      .catch((err: unknown) => finish({ status: "failed", guavaCallId: callId, fields: { ...fields }, error: `Inbound listener failed: ${String((err as Error)?.message ?? err)}` }))
      .finally(() => clearTimeout(timer));
  };
  agent.onCallerSpeech(async (call, e) => {
    if (!answered) {
      answered = true;
      hooks.onStage("answered", "Restaurant answered");
    }
    hooks.onTranscript({ speaker: "RESTAURANT", text: e.utterance, at: new Date().toISOString() });
    await collect(call);
  });
  agent.onAgentSpeech(async (call, e) => {
    hooks.onTranscript({ speaker: "AGENT", text: e.utterance, at: new Date().toISOString() });
    await collect(call);
  });
  agent.onTaskComplete(taskId, async (call) => {
    await collect(call);
    hooks.onStage("quote_received", "Quote received");
    await call.hangup(args.hangupLine);
  });
  agent.onSessionEnd(async (call, e) => {
    await collect(call);
    finish({ status: "completed", guavaCallId: call.id, fields: { ...fields }, terminationReason: e.termination_reason });
  });
  agent.onOutboundFailed(async (call, e) => {
    if (callMode() === "auto" && !answered && !ended && direction === "outbound") {
      callId = null;
      listenInbound(`Outbound call failed (${e.error_code}: ${e.error_reason})`);
      return;
    }
    finish({ status: "failed", guavaCallId: call.id, fields: { ...fields }, error: `${e.error_code}: ${e.error_reason}` });
  });

  if (direction === "inbound") {
    listenInbound("GUAVA_CALL_MODE=inbound");
    return;
  }
  agent
    .callPhone(from, toNumber, args.variables ?? {})
    .then(() => {
      if (direction === "outbound") finish({ status: "completed", guavaCallId: callId, fields: { ...fields }, terminationReason: "session-closed" });
    })
    .catch((err: unknown) => {
      const msg = String((err as Error)?.message ?? err);
      // Outbound rejected before anyone spoke (e.g. outbound dialing not approved): let the restaurant dial in.
      if (callMode() === "auto" && !answered && !ended) {
        callId = null;
        listenInbound(`Outbound call failed (${msg.slice(0, 160)})`);
        return;
      }
      finish({ status: "failed", guavaCallId: callId, fields: { ...fields }, error: msg });
    });
}

export const STAGE_LABEL: Partial<Record<VendorStage, string>> = {
  calling: "Calling…",
  answered: "Restaurant answered",
  collecting_menu: "Collecting menu and availability",
  confirming_dietary: "Confirming dietary requirements",
  repeating_quote: "Repeating quote for confirmation",
  quote_received: "Quote received",
};

export function startQuoteCall(args: { toNumber: string; vendorName: string; order: OrderRequest; script: ScriptQuestion[]; hooks: CallHooks }) {
  const { order } = args;
  const deadline = fmtTime(order.deliveryDeadline);
  const agent = makeAgent("Collect a catering quote from a restaurant for a client. Be brief and efficient: one short question at a time, no small talk. You are not placing an order.");

  const fieldFor = (q: ScriptQuestion): FieldDef => ({
    key: q.key,
    stage: q.stage,
    field: guava.Field({
      key: q.key,
      fieldType: q.fieldType,
      question: q.key === "delivery_time" ? `${q.question} We need it by ${deadline}.` : q.question,
      description: q.description ?? (q.builtin ? "" : "The restaurant's answer, in their words"),
      ...(q.choices ? { choices: q.choices } : {}),
      required: q.locked,
    }),
  });

  const checklist = (direction: Direction): ChecklistItem[] => [
    guava.Say(
      `${direction === "inbound" ? "Hi, thanks for calling. " : "Hi, "}I'm an AI assistant getting a catering quote from ${args.vendorName} for ${order.headcount} people. I'm not ordering yet; this takes about two minutes.`,
    ),
    ...args.script.filter((q) => q.enabled).map(fieldFor),
    "Briefly read the quote back: each meal with its price, the delivery fee, and the delivery time.",
    { key: "quote_confirmed", stage: "repeating_quote", field: guava.Field({ key: "quote_confirmed", fieldType: "multiple_choice", choices: ["yes", "no"], question: "Is that correct?" }) },
  ];

  runCall({ agent, toNumber: args.toNumber, taskId: "catering_quote", checklist, hooks: args.hooks, hangupLine: "Thank them, say the client will decide shortly, and say goodbye." });
}

export function startConfirmationCall(args: {
  toNumber: string;
  vendorName: string;
  orderSummary: string;
  deliveryAddress: string;
  deliveryTime: string;
  total: string;
  hooks: CallHooks;
}) {
  const agent = makeAgent("Call a restaurant to confirm a paid catering order on behalf of a client.");
  const checklist = (direction: Direction): ChecklistItem[] => [
    guava.Say(
      `Hi, this is an AI assistant from OpenBid ${direction === "inbound" ? "(thanks for calling in)" : "calling back"} about the catering quote you gave earlier. The client accepted it and has paid ${args.total}. I'd like to confirm the order.`,
    ),
    `Read the order: ${args.orderSummary}. Delivery to ${args.deliveryAddress} at ${args.deliveryTime}.`,
    { key: "order_confirmed", stage: "repeating_quote", field: guava.Field({ key: "order_confirmed", fieldType: "multiple_choice", choices: ["yes", "no"], question: "Can you confirm you will fulfill this order?" }) },
    { key: "confirmed_delivery_time", stage: "repeating_quote", field: guava.Field({ key: "confirmed_delivery_time", fieldType: "text", question: "What time will it arrive?" }) },
    { key: "order_notes", stage: "repeating_quote", field: guava.Field({ key: "order_notes", fieldType: "text", question: "Anything else we should know?", required: false }) },
  ];
  runCall({ agent, toNumber: args.toNumber, taskId: "confirm_order", checklist, hooks: args.hooks, hangupLine: "Thank them and say goodbye." });
}
