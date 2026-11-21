import type { OrderRequest, VendorStage } from "./types";

// The quote-call script. Built-in questions can be toggled (locked ones can't:
// the quote is unusable without them); custom questions are free text.

export interface ScriptQuestion {
  key: string;
  question: string;
  enabled: boolean;
  builtin: boolean;
  locked: boolean;
  fieldType: "text" | "multiple_choice";
  choices?: string[];
  stage: VendorStage;
  description?: string;
}

export function defaultScript(order: OrderRequest): ScriptQuestion[] {
  const std = order.headcount - order.vegetarianQty - order.veganQty;
  const allergy = order.allergies[0];
  const q: ScriptQuestion[] = [
    { key: "can_prepare_count", question: `Can you prepare ${order.headcount} individual meals?`, enabled: true, builtin: true, locked: true, fieldType: "multiple_choice", choices: ["yes", "no"], stage: "collecting_menu" },
    { key: "standard_meal", question: `For the ${std} regular meals, what dish would you suggest and what's the price per meal?`, enabled: true, builtin: true, locked: true, fieldType: "text", stage: "collecting_menu", description: "Dish name AND price per meal" },
  ];
  if (order.vegetarianQty > 0) {
    q.push({ key: "vegetarian_meal", question: `For ${order.vegetarianQty} vegetarian meals, which dish and what price per meal?`, enabled: true, builtin: true, locked: false, fieldType: "text", stage: "confirming_dietary", description: "Dish and price, or that they can't do vegetarian" });
  }
  if (order.veganQty > 0) {
    q.push({ key: "vegan_meal", question: `And for ${order.veganQty} vegan meals?`, enabled: true, builtin: true, locked: false, fieldType: "text", stage: "confirming_dietary", description: "Dish and price, or that they can't do vegan" });
  }
  if (allergy) {
    q.push({ key: "allergen_policy", question: `Can you guarantee the meals are ${allergy}-free? Yes, no, or not guaranteed?`, enabled: true, builtin: true, locked: false, fieldType: "multiple_choice", choices: ["yes", "not guaranteed", "no"], description: `yes = guaranteed ${allergy}-free; not guaranteed = can prepare separately but cross-contact possible`, stage: "confirming_dietary" });
  }
  q.push(
    { key: "delivery_fee", question: "What's the delivery fee?", enabled: true, builtin: true, locked: false, fieldType: "text", stage: "collecting_menu", description: "Dollar amount, or free" },
    { key: "delivery_time", question: "What time can you deliver it?", enabled: true, builtin: true, locked: true, fieldType: "text", stage: "collecting_menu", description: "Clock time" },
    { key: "minimum_order", question: "Is there a minimum order?", enabled: false, builtin: true, locked: false, fieldType: "text", stage: "collecting_menu" },
    { key: "quote_valid", question: "How long is this quote valid?", enabled: false, builtin: true, locked: false, fieldType: "text", stage: "repeating_quote" },
    { key: "meal_options", question: "What other meal options do you have for catering?", enabled: false, builtin: true, locked: false, fieldType: "text", stage: "collecting_menu" },
  );
  return q;
}

export function sanitizeScript(input: ScriptQuestion[], current: ScriptQuestion[]): ScriptQuestion[] {
  const out: ScriptQuestion[] = [];
  let n = 0;
  for (const item of input) {
    const existing = current.find((c) => c.key === item.key && c.builtin);
    if (existing) {
      out.push({ ...existing, enabled: existing.locked ? true : Boolean(item.enabled) });
      continue;
    }
    const text = String(item.question ?? "").trim().slice(0, 300);
    if (!text) continue;
    n += 1;
    out.push({ key: `custom_${n}`, question: text, enabled: item.enabled !== false, builtin: false, locked: false, fieldType: "text", stage: "collecting_menu" });
  }
  // Locked built-ins can never be removed.
  for (const c of current) if (c.locked && !out.some((o) => o.key === c.key)) out.push(c);
  return out;
}
