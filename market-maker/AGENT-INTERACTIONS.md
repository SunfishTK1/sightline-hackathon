# How the three agents work together

One inbox. One price brain. One ethics gate.

| Agent | Package | Owns | Does not own |
|---|---|---|---|
| **Personal agent** | `agent/` + `voice-mcp/` | Talking to humans, intake, completion, **every SMS** | Ranking, price, ethics HTTP |
| **Market-maker** | `market-maker/` | Rank, prime price, evaluate, **call ethics** | Sending job texts, fulfillment chat |
| **Ethics / arbitration** | Daphne’s `gotchu/lib/agents/ethics.ts` | Allow / block / same-job referee | Picking workers or inventing a price |

Phone number is the join key. The personal agent must not require `task-*` / `user-*` ids from this package.

```
Human  <--- SMS only --->  Personal agent  <--quote/evaluate-->  Market-maker  --HTTP-->  Gotchu ethics
```

## Live path

1. Human texts a request. Personal agent files it in voice-mcp (`submit_order`).
2. Personal agent loads open orders + worker candidates from voice-mcp.
3. Personal agent calls **market-maker** `POST /api/broker/quote`.
4. Market-maker returns who to ask, a **prime** `offerUsd` (max P(deal)), and a **travel quote** (distance + walk / bus / drive minutes). Typical prices come from `market_comps` keyed by category + hop length + duration. `pDeal` stays on the payload, not in SMS.
5. Personal agent writes **one** exclusive `job_offers.offered_usd` (top pick only), texts both sides the same price **and** the hop times, and asks the worker if they can make the deadline. It also opens a public `/live/[token]` board on market-maker and texts that URL to the requester. Do not text three people the same job.
6. Human replies YES / NO / COUNTER / need more time. Personal agent calls **`POST /api/broker/evaluate`**.
7. Market-maker returns `ACCEPT` | `COUNTER` | `ASK_REQUESTER` | `TRY_NEXT` | `REJECT_SCOPE`. Time asks return `ASK_REQUESTER` plus `suggestedDeadline`.
8. Personal agent sends **one** follow-up text. It does not invent a second price. On `ACCEPT`, market-maker stores the paid price as a comp.

Market-maker keeps `IMESSAGE_LIVE=false`. Worker invitations from this package stay dry-run. The internal board at `:3000` is for us, not users.

## Personal agent contract

Set `MARKET_MAKER_URL=http://localhost:3000` (already defaulted in `agent/src/config.ts`).

**Must call the broker**

| When | Endpoint | Then |
|---|---|---|
| Open order, have candidates | `POST /api/broker/quote` | `createOffer` **only `picks[0]`**, then text that `offerUsd` |
| Offer or counter silent 10 minutes | `evaluate` `TIMEOUT` | Decline/cancel that offer; rematch picks the next ranked phone |
| Two counters, still no deal | `evaluate` with `round: 2` | `TRY_NEXT` — same as timeout |
| Auto-counter (offer under worker min) | `POST /api/broker/evaluate` `AUTO_WORKER` | Only counter if action is `COUNTER` |
| Auto-accept a worker counter | `evaluate` `AUTO_REQUESTER` | Only accept if action is `ACCEPT` |
| Human YES / NO / COUNTER | `evaluate` `ACCEPT` / `DECLINE` / `COUNTER` / `REQUESTER_YES` / `REQUESTER_NO` | Follow `action`; do not relay free-form haggling |
| Worker needs more time | `evaluate` `NEED_TIME` (or `COUNTER` with a time note) | `ASK_REQUESTER` + `suggestedDeadline` — do not accept a late job |

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
  "suggestedOfferUsd": 14,
  "maximumUsd": 15,
  "travel": {
    "from": "Morewood",
    "to": "Donner",
    "distanceMi": 0.2,
    "walkMin": 5,
    "busMin": 8,
    "driveMin": 5,
    "recommended": "walk",
    "line": "0.2 mi · walk 5 min · bus 8 min · drive 5 min",
    "totalMin": 25,
    "feasibility": "OK",
    "suggestedDeadline": null
  },
  "picks": [
    {
      "phone": "+14125551004",
      "reason": "Offers moving; $14 (~46% both sides say yes); 0.2 mi · walk 5 min",
      "offerUsd": 14,
      "score": 0.71,
      "pDeal": 0.46,
      "askTime": false
    }
  ],
  "skip": [{ "phone": "+14125551001", "reason": "CATEGORY_NOT_OFFERED" }]
}
```

Quote may return several ranked picks. **Text only the first.** When that offer dies (timeout, two counters, decline), voice-mcp excludes that phone and `matchOpenOrders` asks the next one. Parallel blast (3 texts at once) means two people get cancelled when one accepts — campus workers then ignore us.

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

Round cap is **2 counters** (`MAX_NEGOTIATION_ROUNDS`). Silence cap is **10 minutes** (`TIMEOUT`). Either one returns `TRY_NEXT`. Voice-mcp still hard-cancels around 3 rounds if something bypasses the broker.

## Market-maker contract

Deterministic. No LLM chooses the dollar amount.

The first text is a **prime**, not the worker floor. For each $1 in `[workerMin, requesterMax]` we score P(worker accepts) × P(requester accepts) and take the max (ties go cheaper):

- **Worker curve** — 0 under their min, rises toward preferred, reliability nudges it
- **Requester curve** — high below ~70% of `budget_usd`, fades toward their max so we do not always quote the cap
- **History** — `market_comps` (category + distance + duration) plus older task prices. Farther / longer hops price above a next-door campus job.
- **Ratings** — `workerAvgRating / 5` if at least 3 ratings, else 0.7 prior

`clearingPrice()` is still the floor helper. Ranking multiplies fit by close-rate so a slightly worse match who will actually say yes can beat a cheap mismatch.

If the ranges do not overlap, skip that worker (`skip[]`) or return `TRY_NEXT` / `ASK_REQUESTER`. Never invent a deal outside the requester’s max.

Auto band: `agentMayIncreaseToUsd` = the primed offer. `maximumUsd` = requester budget (or a higher cap they published). A counter inside the quote auto-agrees. Between quote and max → ask the requester. Over max or a scope-change note → next candidate.

Workers are upserted by phone so later quotes see the same person.

## Ethics / arbitration contract

Market-maker is the only ethics caller on the live path. The personal agent does **not** call `reviewTask` or `arbitrateMove`. See [`ETHICS-INTEGRATION.md`](../ETHICS-INTEGRATION.md) (Divya).

[`src/lib/market/ethics-gate.ts`](./src/lib/market/ethics-gate.ts) POSTs to Daphne’s Gotchu routes. Set `ETHICS_BASE_URL` (default `http://127.0.0.1:3001` so it does not collide with this app on `:3000`).

| When | Call | If blocked |
|---|---|---|
| `POST /api/broker/quote` | `POST /api/ethics/review` | Empty `picks`, everyone in `skip` with the reason |
| `POST /api/broker/evaluate` (every offer / counter except timeout / decline) | `review` then `POST /api/ethics/arbitrate` | `TRY_NEXT`. `STRIP_AMENDMENTS` keeps price/ETA only |

Verdicts we honor: `ALLOW` and `ALLOW_WITH_CONDITIONS` still quote. `BLOCK` / `BLOCK_TASK` / `REJECT_MOVE` stop the deal. Package pickup and graded work will not pass `reviewTask`.

If Gotchu is down, review falls back to `ALLOW_WITH_CONDITIONS` (“manual review recommended”) and a price-only arbitrate is allowed. Do not copy the deny-list here.

Personal agent still talks to the human. If we return no picks, it should say the request cannot be listed — it should not bargain around the block.

## Completion

Market-maker stops at agreement (`ACCEPT`). Personal agent owns “are you there / did you drop it / review.” Write completion back if you want ratings to feed the next quote (`users.stats` / reviews). There is no live rollup yet.

## Local run

```bash
# terminal 1 — Daphne's ethics HTTP (review / arbitrate)
cd gotchu
npx next dev -p 3001

# terminal 2
cd market-maker
# IMESSAGE_LIVE=false
# ETHICS_BASE_URL=http://127.0.0.1:3001
npm run dev          # :3000

# terminal 3 — voice-mcp (existing VOICE_MCP_URL)

# terminal 4
cd agent
# MARKET_MAKER_URL=http://localhost:3000
npm run dev
```

Checks: `cd market-maker && npm run check:broker && npm run check:policy`
