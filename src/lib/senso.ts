import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { requireEnv } from "./env";
import { loadVendors, vendorDoc } from "./vendors";

// Senso Context Layer REST client (https://docs.senso.ai). Vendor menus,
// allergen/delivery policies and call transcripts are stored as raw KB
// content; the agent queries them with content_id scoping per vendor.

const BASE = "https://apiv2.senso.ai/api/v1";
const INDEX_FILE = path.join(process.cwd(), "data", "senso-index.json");

export interface SensoDoc {
  contentId: string;
  kbNodeId: string;
  title: string;
  hash: string;
  status: "pending" | "processing" | "complete" | "failed";
  ingestedAt: string;
}

interface SensoIndex {
  vendors: Record<string, SensoDoc>;
  transcripts: Record<string, SensoDoc[]>; // by vendorId
}

export interface SensoSearchResult {
  query: string;
  answer: string;
  results: {
    content_chunk_id: string;
    content_id: string;
    chunk_text: string;
    score: number;
    title: string;
  }[];
  processing_time_ms?: number;
}

export class SensoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function senso<T>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "X-API-Key": requireEnv("SENSO_API_KEY"), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new SensoError(res.status, `Senso ${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export function readIndex(): SensoIndex {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return { vendors: {}, transcripts: {} };
  }
}

function writeIndex(idx: SensoIndex) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
}

export async function sensoWhoAmI() {
  return senso<{ org_id: string; name: string; slug: string }>("GET", "/org/me");
}

async function ingestRaw(text: string, title: string, tags: string[]): Promise<SensoDoc> {
  let res: { id: string; kb_node_id: string; processing_status: SensoDoc["status"] };
  try {
    res = await senso("POST", "/org/kb/raw", { text, title, summary: title });
  } catch (e) {
    // Senso rejects byte-identical text with 409; add a revision marker and retry once.
    if (e instanceof SensoError && e.status === 409) {
      res = await senso("POST", "/org/kb/raw", { text: `${text}\n\n_Revision ${new Date().toISOString()}_`, title, summary: title });
    } else throw e;
  }
  const doc: SensoDoc = {
    contentId: res.id,
    kbNodeId: res.kb_node_id,
    title,
    hash: sha(text),
    status: res.processing_status ?? "processing",
    ingestedAt: new Date().toISOString(),
  };
  try {
    await senso("PUT", `/org/kb/nodes/${doc.kbNodeId}/tags`, { tag_names: tags });
  } catch {
    /* tagging is organizational only; ingestion already succeeded */
  }
  return doc;
}

async function waitForProcessing(doc: SensoDoc, timeoutMs = 120_000): Promise<SensoDoc> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const node = await senso<{ content?: { processing_status?: SensoDoc["status"]; error_code?: string } }>(
      "GET",
      `/org/kb/nodes/${doc.kbNodeId}`,
    );
    const s = node.content?.processing_status;
    if (s === "complete" || s === "failed") return { ...doc, status: s };
    await new Promise((r) => setTimeout(r, 4000));
  }
  return doc;
}

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);

/** Ingest every vendor's documents. Skips docs whose content hash is unchanged and processed. */
export async function seedSenso(onProgress?: (msg: string) => void) {
  const idx = readIndex();
  const out: { vendorId: string; doc: SensoDoc; skipped: boolean }[] = [];
  for (const v of loadVendors()) {
    const text = vendorDoc(v);
    const existing = idx.vendors[v.id];
    if (existing && existing.hash === sha(text) && existing.status === "complete") {
      out.push({ vendorId: v.id, doc: existing, skipped: true });
      continue;
    }
    onProgress?.(`Ingesting ${v.name} documents into Senso`);
    let doc = await ingestRaw(text, `${v.name}: menu & policies`, ["openbid", v.id]);
    idx.vendors[v.id] = doc;
    writeIndex(idx);
    doc = await waitForProcessing(doc);
    idx.vendors[v.id] = doc;
    writeIndex(idx);
    out.push({ vendorId: v.id, doc, skipped: false });
  }
  return out;
}

export async function ingestTranscript(vendorId: string, vendorName: string, text: string) {
  const doc = await ingestRaw(text, `${vendorName}: phone quote transcript ${new Date().toISOString()}`, ["openbid", vendorId, "transcript"]);
  const idx = readIndex();
  (idx.transcripts[vendorId] ??= []).push(doc);
  writeIndex(idx);
  return doc;
}

export async function searchVendor(vendorId: string, query: string): Promise<SensoSearchResult> {
  const idx = readIndex();
  const ids = [idx.vendors[vendorId]?.contentId, ...(idx.transcripts[vendorId] ?? []).map((d) => d.contentId)].filter(Boolean);
  if (!ids.length) throw new Error(`No Senso content for ${vendorId}; seed Senso first.`);
  return senso<SensoSearchResult>("POST", "/org/search", {
    query,
    max_results: 4,
    search_type: "hybrid",
    content_ids: ids,
    require_scoped_ids: true,
  });
}
