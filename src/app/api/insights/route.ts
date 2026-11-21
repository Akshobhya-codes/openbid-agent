import { NextResponse } from "next/server";
import { insights, semanticSearch, singlestoreEnabled } from "@/lib/singlestore";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!singlestoreEnabled()) return NextResponse.json({ enabled: false });
  try {
    const q = new URL(req.url).searchParams.get("q");
    if (q) return NextResponse.json({ enabled: true, results: await semanticSearch(q.slice(0, 300), { limit: 8 }) });
    return NextResponse.json({ enabled: true, ...(await insights()) });
  } catch (e) {
    return errorResponse(e, 500);
  }
}
