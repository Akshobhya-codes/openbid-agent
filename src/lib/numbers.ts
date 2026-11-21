// Spoken-number recognition for transcript verification, e.g. "eleven fifty"
// → 11.5, "twelve dollars" → 12, "twenty five" → 25. Used only to *verify*
// that a price the model extracted was actually said, never to produce one.

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Parse runs of number words into integers (0–999). */
function wordRuns(text: string): number[][] {
  const tokens = text.toLowerCase().replace(/-/g, " ").split(/[^a-z0-9.]+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter(Boolean);
  const runs: number[][] = [];
  let cur: number[] = [];
  let acc: number | null = null;
  const flush = () => {
    if (acc !== null) cur.push(acc);
    acc = null;
  };
  for (const t of tokens) {
    if (t in UNITS) {
      const u = UNITS[t];
      if (acc !== null && acc % 10 === 0 && acc >= 20 && u < 10) acc += u;
      else {
        flush();
        acc = u;
      }
    } else if (t in TENS) {
      flush();
      acc = TENS[t];
    } else if (t === "hundred" && acc !== null) {
      acc *= 100;
    } else if (t === "and" || t === "dollars" || t === "dollar" || t === "bucks" || t === "cents") {
      flush();
    } else if (/^\d+(\.\d+)?$/.test(t)) {
      flush();
      cur.push(Number(t));
    } else {
      flush();
      if (cur.length) runs.push(cur);
      cur = [];
    }
  }
  flush();
  if (cur.length) runs.push(cur);
  return runs;
}

/** "around one thirty PM" → "around 1 30 PM"; "twelve forty five" → "12 45". */
export function numberWordsToDigits(text: string): string {
  const parts = text.split(/(\s+|-)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const w = parts[i].toLowerCase().replace(/[^a-z]/g, "");
    if (w in TENS) {
      // tens + unit across a separator: "forty five"
      const nextW = (parts[i + 2] ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (nextW in UNITS && UNITS[nextW] > 0 && UNITS[nextW] < 10) {
        out.push(String(TENS[w] + UNITS[nextW]));
        i += 2;
        continue;
      }
      out.push(String(TENS[w]));
    } else if (w in UNITS) {
      out.push(String(UNITS[w]));
    } else out.push(parts[i]);
  }
  return out.join("").replace(/\b(\d{1,2})[\s-]+o[\s-]?clock\b/gi, "$1:00");
}

export function spokenNumbers(text: string): number[] {
  const out: number[] = [];
  for (const run of wordRuns(text)) {
    for (let i = 0; i < run.length; i++) {
      out.push(run[i]);
      // "eleven fifty" → 11.50 ; "eleven dollars and fifty cents" → 11.50
      if (i + 1 < run.length && run[i + 1] < 100 && Number.isInteger(run[i])) out.push(run[i] + run[i + 1] / 100);
    }
  }
  return out;
}
