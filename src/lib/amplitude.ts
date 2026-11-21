import { getEnv } from "./env";
import type { Variant } from "./types";

// Amplitude HTTP V2 API. Each run is an Amplitude device; the experiment
// variant is set as a user property and an $exposure event, so every agent
// event can be split by "online only" vs "online + phone".

export const EXPERIMENT_FLAG = "openbid-sourcing-mode";

export async function track(runId: string, variant: Variant, eventType: string, props: Record<string, unknown> = {}) {
  const apiKey = getEnv("AMPLITUDE_API_KEY");
  if (!apiKey) return { sent: false as const, reason: "AMPLITUDE_API_KEY not set" };
  const res = await fetch("https://api2.amplitude.com/2/httpapi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      events: [
        {
          device_id: runId,
          event_type: eventType,
          time: Date.now(),
          insert_id: `${runId}-${eventType}-${Date.now()}`,
          event_properties: { ...props, variant, run_id: runId },
          user_properties: { [`[Experiment] ${EXPERIMENT_FLAG}`]: variant },
        },
      ],
    }),
  });
  if (!res.ok) return { sent: false as const, reason: `Amplitude ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { sent: true as const };
}

export async function trackExposure(runId: string, variant: Variant) {
  return track(runId, variant, "$exposure", { flag_key: EXPERIMENT_FLAG, variant });
}
