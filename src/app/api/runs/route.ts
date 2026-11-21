import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun } from "@/lib/pipeline";
import { listRuns } from "@/lib/store";
import { errorResponse } from "@/lib/http";
import { requireEnv } from "@/lib/env";
import type { Variant } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OrderInput = z.object({
  deliveryAddress: z.string().min(3),
  deliveryDeadline: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid deadline"),
  headcount: z.number().int().positive().max(500),
  budget: z.number().positive(),
  vegetarianQty: z.number().int().min(0),
  veganQty: z.number().int().min(0),
  allergies: z.array(z.string().min(1)).max(5),
  foodPreferences: z.string().default(""),
  maxRadiusMiles: z.number().positive().default(5),
  permissionToCall: z.boolean(),
  taxRate: z.number().min(0).max(0.2).default(0.08875),
  rawText: z.string().optional(),
});

export async function GET() {
  return NextResponse.json(
    listRuns().map((r) => ({ id: r.id, createdAt: r.createdAt, status: r.status, variant: r.variant, headcount: r.order.headcount, budget: r.order.budget })),
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const order = OrderInput.parse(body.order);
    if (order.vegetarianQty + order.veganQty > order.headcount) throw new Error("Dietary meal counts exceed headcount");
    if (Date.parse(order.deliveryDeadline) <= Date.now()) throw new Error("Delivery deadline is in the past");
    // Fail fast before the run starts if a required integration is unconfigured.
    for (const k of ["OPENAI_API_KEY", "SENSO_API_KEY"]) requireEnv(k);
    const variantIn = body.variant as string;
    const variant: Variant =
      variantIn === "A_online_only" || variantIn === "B_online_plus_phone"
        ? variantIn
        : Math.random() < 0.5 ? "A_online_only" : "B_online_plus_phone";
    if (variant === "B_online_plus_phone") for (const k of ["GUAVA_API_KEY", "GUAVA_AGENT_NUMBER", "DEMO_RESTAURANT_PHONE"]) requireEnv(k);
    const run = createRun(order, variant);
    return NextResponse.json({ id: run.id, variant });
  } catch (e) {
    return errorResponse(e);
  }
}
