/**
 * Always-on inbound agent: anyone who calls GUAVA_AGENT_NUMBER gets OpenBid's
 * quote agent, with the caller playing the restaurant. Run during judging:
 *
 *   npm run agent:listen
 */
import * as guava from "@guava-ai/guava-sdk";
import { getEnv, requireEnv } from "../src/lib/env";
import { defaultScript } from "../src/lib/questions";
import type { OrderRequest } from "../src/lib/types";

process.env.GUAVA_API_KEY = requireEnv("GUAVA_API_KEY");
const number = requireEnv("GUAVA_AGENT_NUMBER");

const deadline = new Date();
deadline.setHours(13, 30, 0, 0);
const order: OrderRequest = {
  deliveryAddress: "500 Howard St, San Francisco",
  deliveryDeadline: deadline.toISOString(),
  headcount: 40,
  budget: 500,
  vegetarianQty: 10,
  veganQty: 2,
  allergies: ["peanut"],
  foodPreferences: "",
  maxRadiusMiles: 5,
  permissionToCall: true,
  taxRate: 0.08875,
};

const agent = new guava.Agent({
  name: "Ava",
  organization: "OpenBid",
  purpose: "Collect a catering quote from a restaurant for a client. Be brief: one short question at a time. You are not placing an order.",
});

agent.onCallStart(async (call) => {
  console.log(`[${new Date().toLocaleTimeString()}] call ${call.id} started`);
  await call.setTask({
    taskId: "catering_quote",
    checklist: [
      guava.Say(`Hi, thanks for calling OpenBid. I'm an AI procurement agent. Let's pretend you're the restaurant: I'm getting a catering quote for ${order.headcount} people. This takes about two minutes.`),
      ...defaultScript(order)
        .filter((q) => q.enabled)
        .map((q) => guava.Field({ key: q.key, fieldType: q.fieldType, question: q.question, description: q.description ?? "", ...(q.choices ? { choices: q.choices } : {}), required: q.locked })),
      "Briefly read the quote back: each meal with its price, the delivery fee, and the delivery time.",
      guava.Field({ key: "quote_confirmed", fieldType: "multiple_choice", choices: ["yes", "no"], question: "Is that correct?" }),
    ],
  });
});
agent.onCallerSpeech(async (_c, e) => console.log("  RESTAURANT:", e.utterance));
agent.onAgentSpeech(async (_c, e) => console.log("  AGENT:", e.utterance));
agent.onTaskComplete("catering_quote", async (call) => {
  await call.hangup("Thank them, say this is how OpenBid collects quotes from restaurants with no online menu, and say goodbye.");
});
agent.onSessionEnd(async (call, e) => console.log(`[${new Date().toLocaleTimeString()}] call ${call.id} ended (${e.termination_reason})`));

console.log(`OpenBid agent listening on ${number} (${getEnv("DEMO_RESTAURANT_NAME") ?? "demo"} script). Ctrl+C to stop.`);
await agent.listenPhone(number);
