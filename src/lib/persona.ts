import { getEnv, requireEnv } from "./env";

// Persona buyer verification: "the agent shops, a verified human pays".
// Off unless PERSONA_ENABLED=true, so it can never block an order by default.
// Flow: create an inquiry (reference-id = run id) → hosted flow → redirect back
// → we fetch the inquiry and only then create the payment session.

const API = "https://withpersona.com/api/v1";

export const personaEnabled = () =>
  getEnv("PERSONA_ENABLED")?.toLowerCase() === "true" && Boolean(getEnv("PERSONA_API_KEY") && getEnv("PERSONA_TEMPLATE_ID"));

async function persona<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("PERSONA_API_KEY")}`,
      "Persona-Version": "2023-01-05",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Identity verification ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export interface InquiryState {
  inquiryId: string;
  status: string;
  verified: boolean;
}

const VERIFIED = new Set(["completed", "approved"]);

export async function createInquiry(referenceId: string): Promise<InquiryState> {
  const r = await persona<{ data: { id: string; attributes: { status: string } } }>("POST", "/inquiries", {
    data: { attributes: { "inquiry-template-id": requireEnv("PERSONA_TEMPLATE_ID"), "reference-id": referenceId } },
  });
  return { inquiryId: r.data.id, status: r.data.attributes.status, verified: VERIFIED.has(r.data.attributes.status) };
}

export async function getInquiry(inquiryId: string): Promise<InquiryState> {
  if (!/^inq_[A-Za-z0-9]+$/.test(inquiryId)) throw new Error("bad inquiry id");
  const r = await persona<{ data: { id: string; attributes: { status: string; "reference-id"?: string } } }>("GET", `/inquiries/${inquiryId}`);
  return { inquiryId: r.data.id, status: r.data.attributes.status, verified: VERIFIED.has(r.data.attributes.status) };
}

/** Hosted verification flow; Persona redirects back to `redirectUri` when the buyer finishes. */
export function hostedFlowUrl(inquiryId: string, redirectUri: string) {
  const u = new URL("https://withpersona.com/verify");
  u.searchParams.set("inquiry-id", inquiryId);
  u.searchParams.set("redirect-uri", redirectUri);
  return u.toString();
}
