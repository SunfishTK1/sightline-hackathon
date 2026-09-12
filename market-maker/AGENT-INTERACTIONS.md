# How the three agents work together

One inbox. One price brain. One ethics gate.

| Agent | Package | Owns | Does not own |
|---|---|---|---|
| **Personal agent** | `agent/` + `voice-mcp/` + `gotchu/` | Talking to humans, intake, completion, **every SMS** | Ranking, clearing price, who wins |
| **Market-maker** | `market-maker/` | Rank, clearing price, evaluate YES / COUNTER / decline | Sending job texts, fulfillment chat |
| **Ethics / arbitration** | Will’s `gotchu/lib/agents/ethics.ts` (and a future teammate service) | Allow / block / cap rounds / reject hostage terms | Picking workers or inventing a price |

Phone number is the join key. The personal agent must not require `task-*` / `user-*` ids from this package.

```
Human  <--- SMS only --->  Personal agent  <--quote/evaluate-->  Market-maker
                                      |                              |
                                      +-------- ethics gate ---------+
```

## Live path

1. Human texts a request. Personal agent files it in voice-mcp (`submit_order`).
2. Personal agent loads open orders + worker candidates from voice-mcp.
3. Personal agent calls **market-maker** `POST /api/broker/quote`.
4. Market-maker returns who to ask and at what `offerUsd`.
5. Personal agent writes `job_offers.offered_usd` (not the requester’s budget) and **sends the SMS**.
6. Human replies YES / NO / COUNTER. Personal agent calls **`POST /api/broker/evaluate`**.
7. Market-maker returns `ACCEPT` | `COUNTER` | `ASK_REQUESTER` | `TRY_NEXT` | `REJECT_SCOPE`.
8. Personal agent sends **one** follow-up text. It does not invent a second price.

Market-maker keeps `IMESSAGE_LIVE=false`. Worker invitations from this package stay dry-run. The internal board at `:3000` is for us, not users.

## Personal agent contract

Set `MARKET_MAKER_URL=http://localhost:3000` (already defaulted in `agent/src/config.ts`).

**Must call the broker**

| When | Endpoint | Then |
|---|---|---|
| Open order, have candidates | `POST /api/broker/quote` | `createOffer(..., offered_usd)` then text `offered_usd` |
| Auto-counter (offer under worker min) | `POST /api/broker/evaluate` `AUTO_WORKER` | Only counter if action is `COUNTER` |
| Auto-accept a worker counter | `evaluate` `AUTO_REQUESTER` | Only accept if action is `ACCEPT` |
| Human YES / NO / COUNTER | `evaluate` `ACCEPT` / `DECLINE` / `COUNTER` / `REQUESTER_YES` / `REQUESTER_NO` | Follow `action`; do not relay free-form haggling |

**Must not**

- Send a job SMS before a quote (unless the broker is down — LLM fallback in `pickWorkers` is allowed so intake does not die).
- Overwrite requester `budget_usd` with the market offer. Those are different columns.
- Forward a counter note that looks like a new job (coffees, “or I cancel”). If evaluate returns `REJECT_SCOPE`, tell the worker no and go to the next person.
- Open a second iMessage sender. Do not turn on `IMESSAGE_LIVE` on market-maker.

**Quote body (phone-keyed)**

```json
{
  "order": {
    "id": "uuid",
    "title": "Move mini fridge Morewood to Donner",
    "details": "...",
    "category": "moving",
    "pickup_location": "Morewood",
    "dropoff_location": "Donner",
    "deadline_at": "2026-09-12T18:00:00-04:00",
    "budget_usd": 15,
    "requester_phone": "+14808497383"
  },
  "candidates": [
    {
      "phone": "+14125551004",
      "blurb": "I move fridges",
      "categories": ["MOVING"],
      "min_price_usd": 12
    }
  ]
}
```

**Quote response**

```json
{
  "suggestedOfferUsd": 12,
  "maximumUsd": 15,
  "picks": [
    { "phone": "+14125551004", "reason": "Offers moving; market offer $12", "offerUsd": 12, "score": 0.71 }
  ],
  "skip": [{ "phone": "+14125551001", "reason": "CATEGORY_NOT_OFFERED" }]
}
```

Ask at most two picks (same as today). Text the per-pick `offerUsd`.

**Evaluate body**

```json
{
  "order": { "title": "Move mini fridge", "budget_usd": 15, "category": "moving" },
  "current_offer_usd": 12,
  "decision": "COUNTER",
  "price_usd": 14,
  "note": "needs two hands",
  "round": 1
}
```

`current_offer_usd` is the **market offer already texted**, not the new ask. `price_usd` is the worker’s counter (or the number `AUTO_REQUESTER` is deciding).

**Evaluate actions**

| Action | Personal agent does |
|---|---|
| `ACCEPT` | Close the deal at `agreedUsd`. Text both sides. Hand fulfillment to the personal agent. |
| `COUNTER` | Text the worker `nextOfferUsd`. Do not ask the requester yet. |
| `ASK_REQUESTER` | One YES/NO to the requester. No side-channel Q&A. |
| `TRY_NEXT` | Drop this worker. Quote again or take the next pick. |
| `REJECT_SCOPE` | Do not forward the note. Treat as a new task or the next worker. |

Round cap is 3 (`MAX_NEGOTIATION_ROUNDS`). After that, evaluate returns `TRY_NEXT`.

## Market-maker contract

Deterministic. No LLM chooses the dollar amount.

Clearing price is the lowest number in `[max(workerMin, categoryFloor), requesterMax]`:

- **Current request** — `budget_usd`, deadline, category, pickup/dropoff
- **Worker** — min / preferred price, availability, categories
- **Ratings** — `workerAvgRating / 5` if at least 3 ratings, else 0.7 prior
- **History** — median paid for the same category on accepted/completed tasks, plus optional `comps` from the agent

If the ranges do not overlap, skip that worker (`skip[]`) or return `TRY_NEXT` / `ASK_REQUESTER`. Never invent a deal outside the requester’s max.

Auto band: `agentMayIncreaseToUsd` = the quoted offer. `maximumUsd` = requester budget (or a higher cap they published). A counter inside the quote auto-agrees. Between quote and max → ask the requester. Over max or a scope-change note → next candidate.

Workers are upserted by phone so later quotes see the same person.

## Ethics / arbitration contract

Every quote and every evaluate already calls `reviewBrokerAction()` in [`src/lib/market/ethics-gate.ts`](./src/lib/market/ethics-gate.ts). Today it always returns `ALLOW`. That is the hook.

**Will / ethics teammate: replace the body of that function** (or have it HTTP out to your service). Do not add a second gate on the SMS path.

Call it **before** we return a price or an action. If you `BLOCK`:

- Quote: empty `picks`, everyone in `skip` with your reason
- Evaluate: we treat it as `TRY_NEXT` and do not tell the personal agent to send a coercive counter

What ethics should decide (not market-maker):

- Task is allowed on campus (denylist + rubric you already have in `gotchu/lib/agents/ethics.ts`)
- A counter note is hostage / extra unpaid labor / a different job
- Too many rounds or the thread is two humans relaying through the agent
- Block specific outbound wording if needed

What ethics should **not** decide: who ranks first, or the clearing dollar amount, unless the price itself is abusive (then `BLOCK` and say why).

Suggested verdict shape (already on the hook):

```ts
{ allowed: boolean; verdict: "ALLOW" | "BLOCK"; reasons: string[] }
```

If you later need `ALLOW_WITH_CONDITIONS`, return `ALLOW` plus conditions in `reasons[]` and we can thread them into `messageHint`. Until then, keep it binary.

Personal agent still talks to the human. If ethics blocks, the personal agent should say the request cannot be listed — it should not bargain around the block.

## Completion

Market-maker stops at agreement (`ACCEPT`). Personal agent owns “are you there / did you drop it / review.” Write completion back if you want ratings to feed the next quote (`users.stats` / reviews). There is no live rollup yet.

## Local run

```bash
# terminal 1
cd market-maker
# IMESSAGE_LIVE=false
npm run dev          # :3000

# terminal 2 — voice-mcp (existing VOICE_MCP_URL)

# terminal 3
cd agent
# MARKET_MAKER_URL=http://localhost:3000
npm run dev
```

Checks: `cd market-maker && npm run check:broker && npm run check:policy`
