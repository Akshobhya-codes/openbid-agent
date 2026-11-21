"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Run } from "@/lib/types";

const Ctx = createContext<{ run: Run | null; error: string | null; refresh: () => void }>({ run: null, error: null, refresh: () => {} });

export function RunProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setRun(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [refresh]);
  return <Ctx.Provider value={{ run, error, refresh }}>{children}</Ctx.Provider>;
}

export const useRun = () => useContext(Ctx);
