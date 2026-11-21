import { NextResponse } from "next/server";
import { markPaid } from "@/lib/pipeline";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { sessionId } = (await req.json()) as { sessionId: string };
    return NextResponse.json(await markPaid(id, sessionId, "redirect"));
  } catch (e) {
    return errorResponse(e);
  }
}
