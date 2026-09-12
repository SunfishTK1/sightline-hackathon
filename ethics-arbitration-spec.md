# Ethics & Arbitration Agent — Daphne (standalone)

Addendum. Implementation in `gotchu/`. The overall team spec is `gotchu-hackathon-spec.md` (updated to match this file).

Build this as its own module. Thomas (personal agent) and Divya/you (market-making / negotiate loop) **call your functions**. They do not reimplement the rubric.

Until the main app is wired, you can run this with fake tasks and a script. Same input/output later.

---

## What this agent is

Two jobs, one agent:

1. **Ethics (gate)** — Is this allowed on a CMU student marketplace at all?
2. **Arbitration (referee)** — During matching and negotiation, is this still the *same job*, and is **price the only thing being traded**?

Agents may **tweak details** of the same job (paint the fence *navy* instead of *white*). They may **not** morph it into a different job (paint the fence → write my 15-213 lab). They may **not** barter extra work, locations, or people — only dollars.

---

## Who calls you (do not wait for them)

| Caller | When | Function |
|---|---|---|
| **Personal AI (Thomas)** | After `parseTask`, before the task is `OPEN` | `reviewTask(structured)` |
| **Personal AI (Thomas)** | User (or agent) edits structured fields on the compose card | `reviewAmendment(original, proposed)` |
| **Personal AI (Thomas)** | Each `nextMove` *before* it is appended to the transcript | `arbitrateMove(...)` |
| **Market-making (negotiate loop)** | Same: after each `nextMove`, before save | `arbitrateMove(...)` |
| **Will (completion)** | After a review comment is posted | `reviewComment(comment)` |

Export **plain functions**. Also expose HTTP routes so you can demo the agent alone. Callers should import the function, not HTTP, in production.

---

## Rule in one sentence

**Price is the only thing exchanged. Details of the same task may shift. The task itself may not.**

### Same task (allow)

- Fence: white → navy, satin → matte, “front yard” → “front + gate”
- Pickup: UC mailroom → UC loading dock (same building / same errand)
- Time: “before 6” → “before 6:30” if still the same deadline window
- ETA minutes changing with the price offer

### Different task (reject the move, keep the original job)

- Fence painting → also take my 15-213 exam
- Package UC → Gates becomes “drive me to the airport”
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
| “Do my graded work” vs “explain a concept” | Deadline slip of a small amount (your prompt: not more than ~2 hours, never past the original day if it was same-day) |

If you’re unsure, **reject the amendment, keep the original, let price still move.** Fail closed on identity; fail open on cosmetics.

---

## Functions (contract)

All return `{ ok: true, data }` shape from routes; functions themselves return the `data` object. Zod-validate. On LLM failure, return the **fallback** below — never throw to the caller.

### 1. `reviewTask(structured) → EthicsVerdict`

Gate before the pool. Same spirit as the original ethics agent.

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

**BLOCK:** graded work (papers, quizzes, exams, problem sets done *for* them) — CMU Academic Integrity / unauthorized assistance; **package pickup** (The Word: false ID / misrepresentation / unauthorized access credentials); alcohol/tobacco/controlled substances; impersonation / “use my ID”; illegal; real physical danger.

Decisions cite a distilled Student Handbook (“The Word”) in `gotchu/lib/prompts/ethics-handbook.ts`, not the full copyrighted handbook.

**ALLOW_WITH_CONDITIONS:** private residence, tutoring for *concepts* not *doing the work*. No dollar cap — price size is not an ethics issue.

**ALLOW:** food, moving, errands, campus delivery, event help, painting a fence, etc.

**Fallback if the model dies:** `ALLOW_WITH_CONDITIONS`, condition `Manual review recommended — ethics model unavailable.`, reason explaining that. *Exception:* deny-list prefilter still **BLOCK**s instantly (exam, homework submission, package pickup, alcohol for minors, prescription, weapons, “use my ID”).

### 2. `reviewAmendment(originalStructured, proposedStructured) → AmendmentVerdict`

Used when Thomas’s compose card is edited, or when a negotiate move includes a proposed field change.

```ts
type AmendmentVerdict = {
  verdict: "ALLOW" | "REJECT"
  sameTask: boolean
  allowedChanges: { path: string; from: unknown; to: unknown }[]
  rejectedChanges: { path: string; from: unknown; to: unknown; why: string }[]
  reason: string
}
```

If `REJECT`, callers must keep `originalStructured` (or last allowed structured). They may still change `maxPriceUsd` / offer price without calling this — price is not an amendment to the job.

**Fallback:** `REJECT` everything except price-shaped fields (`maxPriceUsd`, `estimatedMinutes`). `sameTask: true` only if non-price fields are identical.

### 3. `arbitrateMove(input) → ArbitrationVerdict`

Called on **every** agent turn in the negotiate loop (and Thomas should run it inside `nextMove` *or* you run it in `runNegotiation` — **once per turn, not twice**. Team rule: **the negotiate loop owns the call**. Thomas’s `nextMove` just proposes. You referee.

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
    // optional job tweaks this turn — may be empty
    amendments?: { path: string; to: unknown }[]
  }
  transcript: NegotiationMessage[]
}

type ArbitrationVerdict = {
  verdict: "ALLOW" | "STRIP_AMENDMENTS" | "REJECT_MOVE" | "BLOCK_TASK"
  priceUsd: number          // echo, or clamp note — you do not set the price, you only pass it through
  structured: StructuredTask // currentStructured, plus allowed amendments only
  stripped: { path: string; why: string }[]
  reason: string            // one sentence for the replay UI
}
```

| Verdict | Meaning | Caller does |
|---|---|---|
| `ALLOW` | Price offer + any tweaks are still the same job | Append move; save `structured` |
| `STRIP_AMENDMENTS` | Price OK; job tweaks not OK | Append move **with price/ETA/accept only**; ignore amendments |
| `REJECT_MOVE` | The turn itself is nonsense (e.g. tried to trade non-price) | Do **not** append; same agent retries once, then skip turn |
| `BLOCK_TASK` | Ethics problem appeared mid-deal (buy alcohol, do my homework) | Stop negotiation; task `BLOCKED` or `NO_MATCH`; do not approve |

You **do not** decide whether $9 vs $11 is fair. Reservation clamping stays in Thomas’s code. You only care: is this still a price offer on the same job, and is the job still allowed.

**Fallback:** `STRIP_AMENDMENTS`, pass `priceUsd` through, `structured = currentStructured`.

### 4. `reviewComment(comment: string) → { ethicsFlag: string | null }`

Same as before. Deny-list or LLM. Fallback: `null`.

---

## Implementation order (build this first, alone)

1. **Types + zod** in `lib/types/ethics.ts` (verdicts above). Don’t wait for Will if you’re solo — keep names identical so you can drop them in.
2. **Deny-list** `lib/prompts/ethics-denylist.ts` — regex, no LLM, used by `reviewTask` and `arbitrateMove` (if rationale or amendment text trips it → `BLOCK` / `BLOCK_TASK`).
3. **Mocks** `mocks/ethics.ts` — canned examples below. Your first demo can run 100% on mocks.
4. **`reviewTask`** with Gemini or Claude JSON mode (Will’s `lib/llm.ts` when it exists; until then your own thin client).
5. **`reviewAmendment` + `arbitrateMove`** — one prompt that sees original vs proposed.
6. **HTTP for solo demo:**
   - `POST /api/ethics/review` `{ structured }`
   - `POST /api/ethics/amendment` `{ original, proposed }`
   - `POST /api/ethics/arbitrate` `{ ...ArbitrateInput }`
7. **Log** every call to `ethics_log`: input, output, latency, which function. Judges like an audit trail.
8. **Wire later:** Thomas calls `reviewTask` / `reviewAmendment`. Negotiate loop calls `arbitrateMove` after each `nextMove`.

Hard caps: 8s per LLM call, 1 retry, then fallback. Arbitration must not blow the negotiate 20s budget — if you’re over ~4s, use the strip-amendments fallback.

---

## Prompt sketch (arbitration)

```
You are the ethics and arbitration agent for Gotchu, a CMU student task marketplace.

The ORIGINAL task is the identity of the job. It must not become a different job.
Cosmetic or parametric tweaks to the SAME job are allowed (e.g. fence color).
The ONLY thing agents may exchange or bargain is price (USD). ETA may accompany a price.
Reject barter, extra unrelated chores, impersonation, graded academic work, alcohol/IDs, illegal or dangerous work.

Return JSON only:
{ "verdict": "ALLOW" | "STRIP_AMENDMENTS" | "REJECT_MOVE" | "BLOCK_TASK",
  "sameTask": true/false,
  "stripped": [{ "path": "...", "why": "..." }],
  "reason": "one sentence" }
```

---

## Canned tests (use these in `mocks/` and in a `scripts/ethics-smoke.ts`)

| # | Input | Expected |
|---|---|---|
| 1 | “Pick up package UC → Gates, $10” | `reviewTask` BLOCK, `credential_misuse` |
| 2 | “Write my 15-213 lab for $50” | `reviewTask` BLOCK, `academic_integrity` |
| 3 | Original: paint fence white. Proposed: paint fence navy | `reviewAmendment` ALLOW, `sameTask: true` |
| 4 | Original: paint fence. Proposed: paint fence AND write my essay | `REJECT`, `sameTask: false` |
| 5 | Worker move: `$12`, no amendments | `arbitrateMove` ALLOW |
| 6 | Worker move: `$8` + amendment “also walk the dog” | STRIP_AMENDMENTS or REJECT_MOVE; job unchanged |
| 7 | Requester move: pay `$0` if worker “uses my dining ID” | BLOCK_TASK, `credential_misuse` |
| 8 | Color change + price `$40` → `$35` | ALLOW both |

If the model fails tests 2, 4, or 7, tighten the prompt; do not “be nicer.”

---

## What you do **not** build in this folder of work

- The negotiate loop UI / transcript replay (still your other workstream, later)
- Matching / vector search (Divya)
- `parseTask` / `nextMove` (Thomas) — they call you
- Auth0 / seed users (Will)

When you merge: one folder `lib/agents/ethics.ts` plus prompts. Will stops owning `reviewTask`; he still *calls* `reviewComment`.

---

## Demo line (when it’s wired)

After the 15-213 block: “And if two agents try to quietly change the job — paint my fence becoming write my lab — arbitration strips that. They can change the color. They can only trade on price.”
