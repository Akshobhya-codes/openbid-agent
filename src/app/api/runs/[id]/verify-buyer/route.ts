import { NextResponse } from "next/server";
import { completeVerification } from "@/lib/pipeline";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await completeVerification(id));
  } catch (e) {
    return errorResponse(e);
  }
}
