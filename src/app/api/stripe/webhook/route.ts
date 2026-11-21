import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getEnv } from "@/lib/env";
import { markPaid } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not set" }, { status: 412 });
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig ?? "", secret);
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${(e as Error).message}` }, { status: 400 });
  }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const runId = s.metadata?.orderId;
    if (runId) {
      try {
        await markPaid(runId, s.id, "webhook");
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      }
    }
  }
  return NextResponse.json({ received: true });
}
