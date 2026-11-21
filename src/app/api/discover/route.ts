import { NextResponse } from "next/server";
import { discoverAll } from "@/lib/discovery";
import { loadVendors } from "@/lib/vendors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prefetch: the order form calls this as soon as an address is entered, so results are ready (or in flight) at submit. */
export async function POST(req: Request) {
  const b = (await req.json()) as { address?: string; maxRadiusMiles?: number; foodPreferences?: string; headcount?: number; vegetarianQty?: number; veganQty?: number };
  if (!b.address || b.address.trim().length < 5) return NextResponse.json({ ok: false });
  const chains = loadVendors().filter((v) => !v.demo).map((v) => v.name);
  void discoverAll(
    b.address,
    {
      maxRadiusMiles: Number(b.maxRadiusMiles) || 5,
      foodPreferences: b.foodPreferences ?? "",
      headcount: Number(b.headcount) || 20,
      vegetarianQty: Number(b.vegetarianQty) || 0,
      veganQty: Number(b.veganQty) || 0,
    },
    chains,
  ).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
