import fs from "node:fs";
import path from "node:path";
import { getEnv } from "./env";

export interface CatalogItem {
  sku: string;
  name: string;
  category: "standard" | "vegetarian" | "vegan";
  price: number;
  labels: string[];
}

export interface Vendor {
  id: string;
  name: string;
  sourceType: "catalog" | "phone";
  address: string;
  distanceMiles: number;
  docFile: string;
  phoneEnvKey?: string;
  /** Demo restaurant: fictional, phone line is the presenter's phone. */
  demo?: boolean;
  catalog?: {
    sourceUrl: string;
    snapshotFile: string;
    snapshotDate: string;
    deliveryFee: number;
    minimumOrder: number;
    leadTimeMinutes: number;
    deliveryBufferMinutes: number;
    maxMealsPerOrder: number;
    items: CatalogItem[];
  };
}

const DEMO_DEFAULT_NAME = "Local Kitchen";

export function loadVendors(): Vendor[] {
  const raw = fs.readFileSync(path.join(process.cwd(), "data", "vendors.json"), "utf8");
  const demoName = getEnv("DEMO_RESTAURANT_NAME") ?? DEMO_DEFAULT_NAME;
  return (JSON.parse(raw) as { vendors: Vendor[] }).vendors.map((v) => (v.demo ? { ...v, name: demoName } : v));
}

export function getVendor(id: string): Vendor {
  const v = loadVendors().find((x) => x.id === id);
  if (!v) throw new Error(`unknown vendor ${id}`);
  return v;
}

export function vendorDoc(v: Vendor): string {
  const text = fs.readFileSync(path.join(process.cwd(), v.docFile), "utf8");
  return v.demo ? text.replaceAll(DEMO_DEFAULT_NAME, v.name) : text;
}
