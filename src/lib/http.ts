import { NextResponse } from "next/server";
import { MissingEnvError } from "./env";

export function errorResponse(e: unknown, status = 400) {
  const message = String((e as Error)?.message ?? e);
  return NextResponse.json(
    { error: message, missingEnv: e instanceof MissingEnvError ? e.key : undefined },
    { status: e instanceof MissingEnvError ? 412 : status },
  );
}

/** Diagnostics endpoints are only served to this machine. */
export function isLocalRequest(req: Request) {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}
