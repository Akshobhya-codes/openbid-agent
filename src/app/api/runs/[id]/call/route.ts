import { NextResponse } from "next/server";
import { approveCall, callCandidate, declineCall } from "@/lib/pipeline";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { vendorId?: string; candidateId?: string; action: "approve" | "decline" };
    if (body.candidateId) await callCandidate(id, body.candidateId);
    else if (body.action === "approve") await approveCall(id, body.vendorId!);
    else declineCall(id, body.vendorId!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
