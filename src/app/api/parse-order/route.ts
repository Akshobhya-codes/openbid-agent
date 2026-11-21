import { NextResponse } from "next/server";
import { parseOrderText } from "@/lib/ai";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text: string };
    if (!text?.trim()) throw new Error("Empty request");
    return NextResponse.json(await parseOrderText(text));
  } catch (e) {
    return errorResponse(e);
  }
}
