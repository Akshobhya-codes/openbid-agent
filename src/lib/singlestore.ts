import mysql from "mysql2/promise";
import OpenAI from "openai";
import { getEnv, requireEnv } from "./env";
import type { Quote, Run } from "./types";

// SingleStoreDB: durable store for runs, the audit trail and every quote.
// Quotes carry an OpenAI embedding (VECTOR(1536)) so the agent can pull
// vendor price history and semantically similar past orders as evidence.
//
// The pipeline keeps its synchronous JSON working copy (data/runs) for the
// live dashboard; every save is mirrored here (debounced, idempotent upserts).

const EMBED_MODEL = "text-embedding-3-small";
const DIM = 1536;

export const singlestoreEnabled = () => Boolean(getEnv("SINGLESTORE_HOST") && getEnv("SINGLESTORE_PASSWORD"));

type G = {
  __s2?: { pool: mysql.Pool; sig: string; schema?: Promise<void> };
  __s2Timers?: Map<string, NodeJS.Timeout>;
  __s2Synced?: Map<string, Set<string>>;
  __s2LastError?: string | null;
};
const g = globalThis as unknown as G;

function pool(): mysql.Pool {
  const cfg = {
    host: requireEnv("SINGLESTORE_HOST"),
    port: Number(getEnv("SINGLESTORE_PORT") ?? 3306),
    user: getEnv("SINGLESTORE_USER") ?? "admin",
    password: requireEnv("SINGLESTORE_PASSWORD"),
    database: getEnv("SINGLESTORE_DATABASE") ?? "openbid",
  };
  const sig = JSON.stringify(cfg);
  if (!g.__s2 || g.__s2.sig !== sig) {
    void g.__s2?.pool.end().catch(() => undefined);
    g.__s2 = {
      sig,
      pool: mysql.createPool({ ...cfg, ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true }, connectionLimit: 4, dateStrings: true }),
    };
  }
  return g.__s2.pool;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS runs (
    id VARCHAR(40) NOT NULL, created_at DATETIME(6), updated_at DATETIME(6), status VARCHAR(40), variant VARCHAR(40),
    address TEXT, headcount INT, budget DOUBLE, selected_vendor VARCHAR(200), total_paid DOUBLE, data JSON,
    PRIMARY KEY (id), SHARD KEY (id))`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    run_id VARCHAR(40) NOT NULL, id VARCHAR(40) NOT NULL, at DATETIME(6), actor VARCHAR(30), action TEXT,
    confidence DOUBLE, decision_affected TEXT, human_approval JSON, evidence JSON, raw JSON,
    PRIMARY KEY (run_id, id), SHARD KEY (run_id))`,
  `CREATE TABLE IF NOT EXISTS quotes (
    run_id VARCHAR(40) NOT NULL, id VARCHAR(40) NOT NULL, vendor_id VARCHAR(300), vendor_name VARCHAR(200),
    source_type VARCHAR(20), total DOUBLE, delivery_fee DOUBLE, confidence DOUBLE, created_at DATETIME(6),
    summary TEXT, data JSON, embedding VECTOR(${DIM}),
    PRIMARY KEY (run_id, id), SHARD KEY (run_id))`,
];

async function ensureSchema() {
  pool();
  g.__s2!.schema ??= (async () => {
    for (const ddl of SCHEMA) await pool().query(ddl);
  })().catch((e) => {
    g.__s2!.schema = undefined;
    throw e;
  });
  return g.__s2!.schema;
}

const dt = (iso: string | undefined | null) => (iso ? iso.replace("T", " ").replace("Z", "") : null);

async function embed(texts: string[]): Promise<number[][]> {
  const res = await new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") }).embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}

export function quoteSummary(q: Quote, address?: string) {
  const items = q.items.map((i) => `${i.quantity} ${i.category} ${i.name}${i.unitPrice !== null ? ` at $${i.unitPrice}` : ""}`).join("; ");
  return `${q.vendorName} (${q.sourceType}) catering quote${address ? ` for ${address}` : ""}: ${items}. Delivery fee ${q.deliveryFee ?? "unknown"}. Total ${q.total ?? "unknown"}. Vegetarian ${q.vegetarian.status}, vegan ${q.vegan.status}${q.allergen ? `, ${q.allergen.allergy} ${q.allergen.status}` : ""}.`;
}

/** Mirror a run (row, new audit events, new quotes + embeddings). Idempotent. */
export async function syncRun(run: Run) {
  await ensureSchema();
  const sel = run.selection ? run.quotes.find((q) => q.id === run.selection!.quoteId) : null;
  await pool().execute(
    `INSERT INTO runs (id, created_at, updated_at, status, variant, address, headcount, budget, selected_vendor, total_paid, data)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at), status=VALUES(status), selected_vendor=VALUES(selected_vendor), total_paid=VALUES(total_paid), data=VALUES(data)`,
    [run.id, dt(run.createdAt), dt(run.updatedAt), run.status, run.variant, run.order.deliveryAddress, run.order.headcount, run.order.budget, sel?.vendorName ?? null, run.payment?.status === "paid" ? run.payment.amountTotal : null, JSON.stringify(run)],
  );

  g.__s2Synced ??= new Map();
  const synced = g.__s2Synced.get(run.id) ?? new Set<string>();
  g.__s2Synced.set(run.id, synced);

  const newEvents = run.audit.filter((a) => !synced.has(a.id));
  if (newEvents.length) {
    const rows = newEvents.map((a) => [run.id, a.id, dt(a.at), a.actor, a.action, a.confidence ?? null, a.decisionAffected ?? null, JSON.stringify(a.humanApproval ?? null), JSON.stringify(a.evidence ?? null), JSON.stringify(a.raw ?? null)]);
    await pool().query(
      `INSERT INTO audit_events (run_id, id, at, actor, action, confidence, decision_affected, human_approval, evidence, raw) VALUES ? ON DUPLICATE KEY UPDATE action=VALUES(action)`,
      [rows],
    );
    for (const a of newEvents) synced.add(a.id);
  }

  const newQuotes = run.quotes.filter((q) => !synced.has(q.id));
  if (newQuotes.length) {
    const summaries = newQuotes.map((q) => quoteSummary(q, run.order.deliveryAddress));
    const vectors = await embed(summaries);
    for (let i = 0; i < newQuotes.length; i++) {
      const q = newQuotes[i];
      await pool().execute(
        `INSERT INTO quotes (run_id, id, vendor_id, vendor_name, source_type, total, delivery_fee, confidence, created_at, summary, data, embedding)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE total=VALUES(total), data=VALUES(data)`,
        [run.id, q.id, q.vendorId, q.vendorName, q.sourceType, q.total, q.deliveryFee, q.quoteConfidence, dt(q.createdAt), summaries[i], JSON.stringify(q), JSON.stringify(vectors[i])],
      );
      synced.add(q.id);
    }
  }
  g.__s2LastError = null;
}

/** Debounced background mirror, called on every run save. */
export function scheduleSync(runId: string, load: () => Run | null) {
  if (!singlestoreEnabled()) return;
  g.__s2Timers ??= new Map();
  clearTimeout(g.__s2Timers.get(runId));
  g.__s2Timers.set(
    runId,
    setTimeout(() => {
      const run = load();
      if (run)
        syncRun(run).catch((e) => {
          g.__s2LastError = String((e as Error)?.message ?? e);
          console.error("[singlestore] sync failed:", g.__s2LastError);
        });
    }, 400),
  );
}

export const lastSyncError = () => g.__s2LastError ?? null;

export async function ping() {
  await ensureSchema();
  const [rows] = await pool().query("SELECT (SELECT COUNT(*) FROM runs) AS runs, (SELECT COUNT(*) FROM quotes) AS quotes, (SELECT COUNT(*) FROM audit_events) AS events");
  return (rows as { runs: number; quotes: number; events: number }[])[0];
}

// ----------------------------------------------------------------- queries

export interface VendorHistory {
  vendorName: string;
  pastQuotes: number;
  avgTotal: number | null;
  minTotal: number | null;
  timesChosen: number;
}

export async function vendorHistory(vendorIds: string[], excludeRunId: string): Promise<VendorHistory[]> {
  if (!vendorIds.length) return [];
  await ensureSchema();
  const [rows] = await pool().query(
    `SELECT q.vendor_name AS vendorName, COUNT(*) AS pastQuotes, AVG(q.total) AS avgTotal, MIN(q.total) AS minTotal,
            SUM(CASE WHEN r.selected_vendor = q.vendor_name THEN 1 ELSE 0 END) AS timesChosen
       FROM quotes q LEFT JOIN runs r ON r.id = q.run_id
      WHERE q.vendor_id IN (?) AND q.run_id <> ?
      GROUP BY q.vendor_name`,
    [vendorIds, excludeRunId],
  );
  return (rows as VendorHistory[]).map((r) => ({ ...r, pastQuotes: Number(r.pastQuotes), timesChosen: Number(r.timesChosen), avgTotal: r.avgTotal === null ? null : Math.round(Number(r.avgTotal) * 100) / 100, minTotal: r.minTotal === null ? null : Number(r.minTotal) }));
}

export interface SimilarQuote {
  runId: string;
  vendorName: string;
  total: number | null;
  summary: string;
  score: number;
  createdAt: string;
}

export async function semanticSearch(text: string, opts: { excludeRunId?: string; limit?: number } = {}): Promise<SimilarQuote[]> {
  await ensureSchema();
  const [vec] = await embed([text]);
  const [rows] = await pool().query(
    `SELECT run_id AS runId, vendor_name AS vendorName, total, summary, created_at AS createdAt,
            DOT_PRODUCT(embedding, (? :> VECTOR(${DIM}))) AS score
       FROM quotes ${opts.excludeRunId ? "WHERE run_id <> ?" : ""}
      ORDER BY score DESC LIMIT ${Math.min(20, opts.limit ?? 5)}`,
    opts.excludeRunId ? [JSON.stringify(vec), opts.excludeRunId] : [JSON.stringify(vec)],
  );
  return (rows as SimilarQuote[]).map((r) => ({ ...r, score: Math.round(Number(r.score) * 1000) / 1000, total: r.total === null ? null : Number(r.total) }));
}

export async function insights() {
  await ensureSchema();
  const [[totals]] = (await pool().query(
    `SELECT COUNT(*) AS runs, SUM(CASE WHEN total_paid IS NOT NULL THEN 1 ELSE 0 END) AS paidOrders, COALESCE(SUM(total_paid),0) AS spend,
            SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed FROM runs`,
  )) as unknown as [{ runs: number; paidOrders: number; spend: number; confirmed: number }[]];
  const [vendors] = await pool().query(
    `SELECT q.vendor_name AS vendorName, q.source_type AS sourceType, COUNT(*) AS quotes, AVG(q.total) AS avgTotal, MIN(q.total) AS minTotal,
            SUM(CASE WHEN r.selected_vendor = q.vendor_name THEN 1 ELSE 0 END) AS wins
       FROM quotes q LEFT JOIN runs r ON r.id = q.run_id GROUP BY q.vendor_name, q.source_type ORDER BY wins DESC, quotes DESC LIMIT 15`,
  );
  const [actors] = await pool().query(`SELECT actor, COUNT(*) AS events FROM audit_events GROUP BY actor ORDER BY events DESC`);
  const [approvals] = await pool().query(
    `SELECT run_id AS runId, at, action FROM audit_events WHERE human_approval IS NOT NULL AND human_approval::$granted = 'true' ORDER BY at DESC LIMIT 10`,
  );
  return { totals, vendors, actors, approvals };
}
