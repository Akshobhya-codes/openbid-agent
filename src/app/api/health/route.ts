import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getEnv } from "@/lib/env";
import { sensoWhoAmI } from "@/lib/senso";
import { stripe } from "@/lib/stripe";
import { isLocalRequest } from "@/lib/http";
import { ping, singlestoreEnabled } from "@/lib/singlestore";
import { personaEnabled } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

async function check(fn: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await fn() };
  } catch (e) {
    return { ok: false, detail: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return NextResponse.json({ error: "localhost only" }, { status: 403 });
  const [openai, senso, stripeC, guava, amplitude, singlestore, persona] = await Promise.all([
    check(async () => {
      const key = getEnv("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY not set");
      const m = await new OpenAI({ apiKey: key }).models.retrieve(getEnv("OPENAI_MODEL") ?? "gpt-5");
      return `Model ${m.id} available`;
    }),
    check(async () => {
      const me = await sensoWhoAmI();
      return `Org ${me.name} (${me.org_id})`;
    }),
    check(async () => {
      const b = await stripe().balance.retrieve();
      return `Test mode OK (livemode=${b.livemode})`;
    }),
    check(async () => {
      const key = getEnv("GUAVA_API_KEY");
      if (!key) throw new Error("GUAVA_API_KEY not set");
      const res = await fetch("https://app.goguava.ai/v1/conversations?limit=1", { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(`Guava ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const missing = ["GUAVA_AGENT_NUMBER", "DEMO_RESTAURANT_PHONE"].filter((k) => !getEnv(k));
      if (missing.length) throw new Error(`API key OK, but ${missing.join(" and ")} not set`);
      return "API key OK. Outbound dialing also needs compliance approval on your Guava org.";
    }),
    check(async () => {
      const key = getEnv("AMPLITUDE_API_KEY");
      if (!key) throw new Error("AMPLITUDE_API_KEY not set (optional)");
      const res = await fetch("https://api2.amplitude.com/2/httpapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, events: [{ device_id: "openbid-healthcheck", event_type: "openbid_connection_test" }] }),
      });
      if (!res.ok) throw new Error(`Amplitude ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return "Test event accepted";
    }),
    check(async () => {
      if (!singlestoreEnabled()) throw new Error("SINGLESTORE_HOST / SINGLESTORE_PASSWORD not set");
      const c = await ping();
      return `Connected: ${c.runs} runs, ${c.quotes} quotes, ${c.events} audit events`;
    }),
    check(async () => {
      if (!personaEnabled()) throw new Error("Off (set PERSONA_ENABLED=true with PERSONA_API_KEY and PERSONA_TEMPLATE_ID to turn on)");
      const res = await fetch("https://withpersona.com/api/v1/inquiries?page[size]=1", { headers: { Authorization: `Bearer ${getEnv("PERSONA_API_KEY")}`, "Persona-Version": "2023-01-05" } });
      if (!res.ok) throw new Error(`Persona ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return "API key OK; buyers are verified before payment";
    }),
  ]);
  return NextResponse.json({ openai, senso, stripe: stripeC, guava, amplitude, singlestore, persona });
}
