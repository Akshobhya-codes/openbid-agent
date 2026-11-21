import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AuditEvent, Run } from "./types";

// Demo persistence: one JSON file per run under ./data/runs. All mutation goes
// through updateRun, which does a synchronous read-modify-write so concurrent
// async pipeline steps in this single Node process cannot interleave.

const RUNS_DIR = path.join(process.cwd(), "data", "runs");

function ensureDir() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

function runPath(id: string) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("bad run id");
  return path.join(RUNS_DIR, `${id}.json`);
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function saveRun(run: Run) {
  ensureDir();
  run.updatedAt = new Date().toISOString();
  const p = runPath(run.id);
  fs.writeFileSync(p + ".tmp", JSON.stringify(run, null, 2));
  fs.renameSync(p + ".tmp", p);
  // Mirror to SingleStore in the background (no-op when not configured).
  const id = run.id;
  void import("./singlestore").then((m) => m.scheduleSync(id, () => getRun(id))).catch(() => undefined);
}

export function getRun(id: string): Run | null {
  try {
    return JSON.parse(fs.readFileSync(runPath(id), "utf8")) as Run;
  } catch {
    return null;
  }
}

export function listRuns(): Run[] {
  ensureDir();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => getRun(f.replace(/\.json$/, "")))
    .filter((r): r is Run => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateRun(id: string, mutate: (run: Run) => void): Run {
  const run = getRun(id);
  if (!run) throw new Error(`run ${id} not found`);
  mutate(run);
  saveRun(run);
  return run;
}

export function audit(id: string, event: Omit<AuditEvent, "id" | "at"> & { at?: string }): AuditEvent {
  const full: AuditEvent = { id: newId("evt"), at: event.at ?? new Date().toISOString(), ...event };
  updateRun(id, (r) => {
    r.audit.push(full);
  });
  return full;
}
