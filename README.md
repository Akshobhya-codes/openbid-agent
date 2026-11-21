# OpenBid

> Tell us what you need. We'll ask the city who can fulfill it.

OpenBid is a procurement agent. It finds real restaurants near your venue. It reads catalog snapshots and menu policies from Senso, and it calls the restaurant with no online menu through Guava. Every quote goes into one structure, and a price without a source is rejected. The agent then rejects vendors that fail a hard requirement, explains its pick, takes payment through Stripe test Checkout, and calls the restaurant back to confirm. Every step is written to an evidence-backed audit trail.

## Run it

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm install
npm run dev            # http://localhost:3000
```

Fill in the keys in `.env.local`. Each key has its link in a comment. The file is re-read on every request, so no restart is needed. Check them with `curl -s -X POST localhost:3000/api/health`. Senso is seeded automatically on the first run.

| Key | Where to get it |
|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `GUAVA_API_KEY` | https://app.goguava.ai/dashboard/api-keys (outbound calls also need approval at /dashboard/compliance) |
| `GUAVA_AGENT_NUMBER` | https://app.goguava.ai/dashboard/phone-numbers |
| `DEMO_RESTAURANT_PHONE` | your phone, E.164; the demo restaurant's line |
| `SENSO_API_KEY` | https://docs.senso.ai/docs/api-keys |
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/test/apikeys (test mode only) |
| `STRIPE_WEBHOOK_SECRET` | optional: `~/.local/bin/stripe listen --forward-to localhost:3000/api/stripe/webhook` |
| `AMPLITUDE_API_KEY` | optional: Amplitude → Settings → Projects |
| `GOOGLE_MAPS_API_KEY` | optional but recommended: enable "Places API (New)". Without it, search uses public OpenStreetMap servers, which can be slow or overloaded. |

## Demo script

1. **New order**: paste the sample request and click *Fill the form from this text* (OpenAI). Enter the venue address, then click *Start sourcing*.
2. **Sourcing**: the venue is geocoded and real nearby restaurants are ranked by fit. Panda Express and Chipotle are pinned to their nearest real branches and quoted from the catalog snapshot, with Senso supplying dietary and allergen evidence. The demo restaurant has no online menu, so you press **📞 Call**.
3. **Calls**: Guava rings your phone. Answer as the owner. The transcript and typed fields stream in live, with the stages Restaurant answered → Collecting menu → Confirming dietary → Repeating quote → Quote received.
4. **Compare**: hard requirements versus soft preferences. Panda Express fails dietary confidence (vegan is unclear), Chipotle is over budget, and the demo restaurant is the best fit if your quote fits the budget. Peanut uncertainty must be acknowledged before ordering.
5. **Checkout**: pay with `4242 4242 4242 4242`. Payment is verified with Stripe. The agent then calls the restaurant back to confirm the order, and the dashboard updates live.
6. **Audit trail**: every event has its evidence, confidence, raw data, the decision it affected, and any human approval. You can download it as `.md` or `.json`.

## Honesty rules built in

- The model never supplies a price. Every price it extracts must quote the restaurant's own words, and the number must appear in that quote. Otherwise the price is dropped and the quote is marked incomplete, so it cannot win.
- Panda Express and Chipotle prices come from a hand-built **snapshot** (`data/vendors.json`), labeled as such everywhere.
- Real restaurants found by search are **never called**. Only the demo restaurant, whose phone is yours, is phoned.
- Variant A of the experiment uses online data only. Variant B adds calls. Both are recorded in Amplitude.

## Sponsor integrations

| Sponsor | What it does in OpenBid |
|---|---|
| Guava | Calls restaurants with no online menu. It runs the editable question script and records live transcripts and typed answers. If outbound dialing fails, it falls back to the restaurant calling in. |
| Senso | Knowledge base of menus, allergen and delivery policies, and call transcripts. It is queried for source-backed dietary evidence. |
| Stripe | Test-mode Checkout. Payment is verified on return or by webhook, and is followed by a confirmation call. |
| Amplitude | Records the A/B experiment (online data only vs online data plus calls) and the agent's funnel events. |
| SingleStore | Mirrors runs, the audit trail and quotes, with vector embeddings on quotes. It powers vendor price history and similar past orders (audit evidence) and the History page. |
| Firedrill | `npm run firedrill` runs restaurant-owner personas through the real quote extraction and grades it with exact USD checks and a grounding rubric. `npm run firedrill -- --dry` runs the same suite locally. |
| Persona | Optional buyer identity check before payment (`PERSONA_ENABLED=true`). Off by default. |

## Architecture

`src/lib/pipeline.ts` orchestrates discovery (`discovery.ts`), Senso (`senso.ts`), OpenAI (`ai.ts`), Guava (`guava.ts`), quote normalization (`quote.ts`), constraint evaluation (`evaluate.ts`), Stripe (`stripe.ts`) and Amplitude (`amplitude.ts`). Runs are stored as JSON in `data/runs/`. Guava calls hold a WebSocket open, so run this on a long-lived Node server (`next dev` / `next start`), not serverless.

## Demo video

[Watch the 3-minute demo with narration](demo/OpenBid-demo.mp4) ([direct link](https://github.com/Akshobhya-codes/openbid-agent/raw/main/demo/OpenBid-demo.mp4)).

**Call our agent:** +1 (484) 317-5593 and play the restaurant. Start it with `npm run agent:listen`.
