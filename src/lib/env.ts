import fs from "node:fs";
import path from "node:path";

// Configuration comes from .env.local (re-read on every call, so edits take
// effect without restarting the server), falling back to process.env.

const DEFAULTS: Record<string, string> = {
  OPENAI_MODEL: "gpt-5",
  DEMO_RESTAURANT_NAME: "Local Kitchen",
  APP_BASE_URL: "http://localhost:3000",
};

const ENV_FILE = path.join(process.cwd(), ".env.local");

function readEnvFile(): Record<string, string> {
  let text = "";
  try {
    text = fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function getEnv(key: string): string | undefined {
  const v = readEnvFile()[key] ?? process.env[key];
  return v && v.trim() ? v.trim() : DEFAULTS[key];
}

export class MissingEnvError extends Error {
  constructor(public key: string) {
    super(`${key} is not set. Add it to .env.local in the project root.`);
  }
}

export function requireEnv(key: string): string {
  const v = getEnv(key);
  if (!v) throw new MissingEnvError(key);
  return v;
}
