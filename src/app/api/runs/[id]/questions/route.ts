import { NextResponse } from "next/server";
import { updateScript } from "@/lib/pipeline";
import { errorResponse } from "@/lib/http";
import type { ScriptQuestion } from "@/lib/questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { items } = (await req.json()) as { items: ScriptQuestion[] };
    if (!Array.isArray(items) || items.length > 40) throw new Error("Invalid question list");
    return NextResponse.json({ items: updateScript(id, items) });
  } catch (e) {
    return errorResponse(e);
  }
}
