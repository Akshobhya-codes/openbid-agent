import { getRun } from "@/lib/store";
import { buildReport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return new Response("not found", { status: 404 });
  const format = new URL(req.url).searchParams.get("format");
  if (format === "json") {
    return new Response(JSON.stringify(run, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="openbid-${id}.json"` },
    });
  }
  return new Response(buildReport(run), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="openbid-${id}.md"` },
  });
}
