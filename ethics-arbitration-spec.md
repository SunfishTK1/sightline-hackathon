# Ethics & Arbitration Agent — Daphne

**Shipped on `main`.** Implementation: `gotchu/lib/agents/ethics.ts`. Teammate wiring: `ETHICS-INTEGRATION.md`. The overall product spec is `gotchu-hackathon-spec.md`.

Thomas, Divya, and `voice-mcp` **call this agent**. They do not copy the deny-list or rewrite the rubric.

Smoke test (from `gotchu/`):

```bash
npm run ethics-smoke
```

---

## What shipped

Daphne owns Gotchu’s ethics and arbitration agent end to end: policy (a distilled Student Handbook / Academic Integrity), the deny-list, the four functions, the HTTP routes other services hit in production, and the canned tests.

| Surface | Where |
|---|---|
| Gate + referee | `gotchu/lib/agents/ethics.ts` — `reviewTask`, `reviewAmendment`, `arbitrateMove`, `reviewComment`, `parseEthicsStructured` |
| Policy | `gotchu/lib/prompts/ethics-handbook.ts`, `ethics-denylist.ts`, `ethics-rubric.ts`, `ethics-arbitrate.ts` |
| HTTP | `POST /api/ethics/review`, `/amendment`, `/arbitrate` |
| Types | `gotchu/lib/types/ethics.ts` |
| Fixtures + tests | `gotchu/mocks/ethics.ts`, `gotchu/scripts/ethics-smoke.ts` |

**Live callers**

- **`voice-mcp`** (text and voice) — `reviewTask` before a request opens; `reviewAmendment` when the requester changes *what the job is*. If the amendment is `REJECT`, the original listing stays; they post a new request instead of rewriting someone else’s offer.
- **`market-maker`** — `ethics-gate.ts` POSTs review on quote and `arbitrateMove` on each evaluate turn.

The agent is deny-list plus handbook-backed heuristics (fail closed on identity, fail open on cosmetics). Rubric/arbitrate prompts exist for a model; they are not required for the live gate. On HTTP parse failure the route 400s; callers must not treat that as “no verdict.”

---

## What this agent is

Two jobs, one agent:

1. **Ethics (gate)** — Is this allowed on a CMU student marketplace at all?
2. **Arbitration (referee)** — During matching and negotiation, is this still the *same job*, and is **price the only thing being traded**?

Agents may **tweak details** of the same job (paint the fence *navy* instead of *white*). They may **not** morph it into a different job (paint the fence → drive me to the airport, or write my 15-213 lab). They may **not** barter extra work, locations, or people — only dollars.

---

## Who calls it

| Caller | When | Function / HTTP |
|---|---|---|
| **`voice-mcp`** (`submit_order`) | After intake, before the order can be matched | `POST /api/ethics/review` |
| **`voice-mcp`** (`update_order`, details change) | Requester rewrites the job over text or a call | `POST /api/ethics/amendment` |
| **`market-maker`** (quote) | Before a task is priced / offered | `POST /api/ethics/review` |
| **`market-maker`** (evaluate) | Each offer / counter, once per turn | `POST /api/ethics/arbitrate` |
| **Will (completion)** | After a review comment is posted | `reviewComment(comment)` — function is shipped; wire when ratings land |

Gotchu-internal code may import the functions. Other packages **must** HTTP — they must not reimplement the rubric.

---

## Rule in one sentence

**Price is the only thing exchanged. Details of the same task may shift. The task itself may not.**

### Same task (allow)

- Fence: white → navy, satin → matte, “front yard” → “front + gate”
- Pickup pin: UC desk → UC loading dock (same building / same errand) — *package pickup itself is still BLOCKED at the gate*
- Time: “before 6” → “before 6:30” if still the same deadline window
- ETA minutes changing with the price offer

### Different task (reject the move, keep the original job)

- Fence painting → also take my 15-213 exam
- Fence painting becomes “drive me to the airport”
- Food run becomes “buy beer with my ID”
- Adding a second, unrelated chore as payment-in-kind (“I’ll paint if you also walk my dog”)

### Not an exchange (reject)

Anything other than `priceUsd` used as the bargain chip: extra hours of unrelated work, swapping who does the task, “I’ll do it for free if you…” that changes the job.

ETA can *accompany* a price offer. It is not traded instead of price.

---

## Frozen vs flexible fields

Snapshot `originalStructured` the moment ethics first **ALLOW**s the task. That snapshot is the identity of the job.

| Frozen (changing these = different task) | Flexible (arbitration may allow) |
|---|---|
| `category` | Color, size, brand, flavor, notes in `requirements` that don’t add a new chore |
| Core action in `title` (pickup vs paint vs tutor) | Exact shade / finish / count within the same action |
| Requester identity / who the work is for | Pickup/dropoff *pin* inside the same place (UC desk vs UC dock) |
| “Do my graded work” vs “explain a concept” | Deadline slip of a small amount (not more than ~2 hours, never past the original day if it was same-day) |

If you’re unsure, **reject the amendment, keep the original, let price still move.** Fail closed on identity; fail open on cosmetics.

---

## Functions (contract)

Routes return `{ ok: true, data }` / `{ ok: false, error }`. Functions return the `data` object. They do not throw to the caller.

HTTP bodies from `voice-mcp` often send `description` (the order details) and snake_case locations. `parseEthicsStructured` folds `description` / `details` into `requirements` so the same-job check sees what the person said, defaults a missing price to `0`, and maps unknown categories to `other`.

### 1. `reviewTask(structured) → EthicsVerdict`

Gate before the pool.

```ts
type EthicsVerdict = {
  verdict: "ALLOW" | "ALLOW_WITH_CONDITIONS" | "BLOCK"
  categories: EthicsCategory[]
  conditions: string[]
  reason: string          // one sentence, to the student
  confidence: number      // 0–1
}

type EthicsCategory =
  | "academic_integrity"
  | "controlled_substances"
  | "physical_safety"
  | "credential_misuse"
  | "harassment"
  | "illegal"
  | "financial_risk"
  | "none"
```

**BLOCK:** graded work done *for* them; **package pickup**; **alcohol at any age** (including 21+ delivery); **barter / non-money pay** (5 coffees, pizza, dining swipes, a hoodie — USD only, even mixed with a dollar price); tobacco/controlled substances; impersonation / “use my ID”; illegal; real physical danger.

Decisions cite a distilled Student Handbook (“The Word”) in `gotchu/lib/prompts/ethics-handbook.ts`, not the full copyrighted handbook.

**ALLOW_WITH_CONDITIONS:** private residence, tutoring for *concepts* not *doing the work*. No dollar cap — price size is not an ethics issue.

**ALLOW:** food, moving, errands, campus delivery, event help, painting a fence, etc. A coffee *run* paid in USD is ALLOW; coffee *as payment* is BLOCK.

**If the model is unused or dies:** deny-list still **BLOCK**s instantly (exam, homework, package pickup, **any alcohol regardless of age**, prescription, weapons, “use my ID”, barter). Otherwise heuristics: tutoring / private home → `ALLOW_WITH_CONDITIONS`; routine campus help → `ALLOW`.

### 2. `reviewAmendment(originalStructured, proposedStructured) → AmendmentVerdict`

Used when a live request’s details change (voice or text `update_order`), or when a negotiate move includes a proposed field change.

```ts
type AmendmentVerdict = {
  verdict: "ALLOW" | "REJECT"
  sameTask: boolean
  allowedChanges: { path: string; from: unknown; to: unknown }[]
  rejectedChanges: { path: string; from: unknown; to: unknown; why: string }[]
  reason: string
}
```

If `REJECT`, callers **keep the original listing**. They do not rewrite an offered job into a different one. They may still change `maxPriceUsd` / deadline without calling this — price and time are not a job amendment.

**HTTP body (both shapes accepted):**

```http
POST /api/ethics/amendment
{ "originalStructured": {…}, "proposedStructured": {…} }
```

or `{ "original": {…}, "proposed": {…} }`. `voice-mcp` posts the `*Structured` names (and now both). A 400 here must not be treated as “skip the same-job check.”

### 3. `arbitrateMove(input) → ArbitrationVerdict`

Called **once per turn** in the market-maker evaluate loop, before save or outreach. Do not also call it from the personal agent.

```ts
type ArbitrateInput = {
  originalStructured: StructuredTask   // frozen identity
  currentStructured: StructuredTask    // last allowed version
  role: "worker_agent" | "requester_agent"
  proposed: {
    priceUsd: number
    etaMinutes: number
    rationale: string
    accept: boolean
    amendments?: { path: string; to: unknown }[]
  }
  transcript: NegotiationMessage[]
}

type ArbitrationVerdict = {
  verdict: "ALLOW" | "STRIP_AMENDMENTS" | "REJECT_MOVE" | "BLOCK_TASK"
  priceUsd: number
  structured: StructuredTask
  stripped: { path: string; why: string }[]
  reason: string
}
```

| Verdict | Meaning | Caller does |
|---|---|---|
| `ALLOW` | Price offer + any tweaks are still the same job | Append move; save `structured` |
| `STRIP_AMENDMENTS` | Price OK; job tweaks not OK | Append **price/ETA/accept only**; ignore amendments |
| `REJECT_MOVE` | The turn itself is nonsense (tried to trade non-price) | Do **not** append; same agent retries once, then skip |
| `BLOCK_TASK` | Ethics problem appeared mid-deal (alcohol, homework, dining ID) | Stop; task `blocked`; do not approve |

This agent **does not** decide whether $9 vs $11 is fair. It only cares: is this still a price offer on the same job, and is the job still allowed.

**Fallback if needed:** `STRIP_AMENDMENTS`, pass `priceUsd` through, keep `currentStructured`.

### 4. `reviewComment(comment: string) → string | null`

Deny-list over a star-rating comment. Returns an `EthicsCategory` or `null`. Fallback: `null`.

---

## HTTP (solo demo and live services)

| Route | Body | Function |
|---|---|---|
| `POST /api/ethics/review` | `{ structured }` | `reviewTask` |
| `POST /api/ethics/amendment` | `{ original, proposed }` **or** `{ originalStructured, proposedStructured }` | `reviewAmendment` |
| `POST /api/ethics/arbitrate` | `ArbitrateInput` | `arbitrateMove` |

Point `ETHICS_BASE_URL` at the Gotchu app (market-maker defaults to `http://127.0.0.1:3001`). Production: `gotchu.velroi.com`.

---

## Canned tests (`npm run ethics-smoke`)

| # | Input | Expected |
|---|---|---|
| 1 | “Pick up package UC → Gates, $10” | `reviewTask` BLOCK, `credential_misuse` |
| 2 | “Write my 15-213 lab for $50” | `reviewTask` BLOCK, `academic_integrity` |
| 2b | Beer delivery, buyer 21+ | BLOCK, `controlled_substances` |
| 2c–2i | Coffees / cookies / hoodie / mixed $40+coffees as **pay** | BLOCK, `financial_risk`; USD coffee *run* ALLOW |
| 3 | Fence white → navy | `reviewAmendment` ALLOW, `sameTask: true` |
| 4 | Fence + write my essay | `REJECT`, `sameTask: false` |
| 5 | Worker move: `$12`, no amendments | `arbitrateMove` ALLOW |
| 6 | `$8` + “also walk the dog” | STRIP_AMENDMENTS (or REJECT_MOVE); job unchanged |
| 7 | Pay `$0` if worker “uses my dining ID” | BLOCK_TASK |
| 8 | Navy + `$35` | ALLOW both |
| 9 | voice-mcp payload: same title, details “drive me to the airport” | `reviewAmendment` REJECT |

If tests 2, 4, or 7 fail, tighten the deny-list; do not “be nicer.”

---

## What this workstream does **not** own

- Matching / live board / SMS outreach (Divya / Thomas)
- `parseTask` / personal-agent prompts (Thomas) — they call the gate
- Auth0 / onboarding / wallet (Will)
- Completing or paying a task (Will / voice-mcp)

Web screens that are still Daphne’s in the Next app: campus map (`/map`, `/api/map`), feed and approval/replay stubs (`/feed`, `/tasks/[taskId]`).

---

## Demo line

After the 15-213 block: “And if two agents try to quietly change the job — paint my fence becoming write my lab, or an airport ride — arbitration keeps the original listing. They can change the color. They can only trade on price.”
