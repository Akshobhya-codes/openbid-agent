import { NextResponse } from "next/server";
import { selectVendor } from "@/lib/pipeline";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { vendorId, allergenAcknowledged, override } = (await req.json()) as { vendorId: string; allergenAcknowledged: boolean; override?: boolean };
    const url = await selectVendor(id, vendorId, Boolean(allergenAcknowledged), Boolean(override));
    return NextResponse.json({ url });
  } catch (e) {
    return errorResponse(e);
  }
}
