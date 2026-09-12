# How to integrate the ethics & arbitration agent

**Owner:** Daphne (`daphnedavila`)  
**Code:** `gotchu/lib/agents/ethics.ts`  
**Contract:** `ethics-arbitration-spec.md`  
**On `main` now.** Pull before you wire anything.

Do **not** copy the deny-list or rewrite the rubric. Call Daphne’s functions (or HTTP). If two of you would both call `arbitrateMove` on the same turn, **only the negotiate loop** should call it.

---

## Policy you must respect

- **Price is the only thing agents exchange.** No dollar cap.
- Same job may flex (fence white → navy). The job may not become a different job.
- **Package pickup is BLOCKED** (needs someone else’s ID). Happy-path demo = food run or paint a fence, **not** UC package pickup.
- Graded work, alcohol/drugs, fake IDs, weapons, illegal/dangerous work → **BLOCK** (The Word / Academic Integrity).

---

## Pull

```bash
git checkout main
git pull origin main
```

Smoke test (optional, from `gotchu/` after `npm install`):

```bash
npm run ethics-smoke
```

---

## Thomas — personal agent / compose / `POST /api/tasks`

You gate tasks **before** they go `OPEN`.

```ts
import { reviewTask, reviewAmendment } from "@/lib/agents/ethics";
```

### Create task

1. `parseTask` as you already do.
2. `const ethics = await reviewTask(structured);`
3. If `ethics.verdict === "BLOCK"` → save task `BLOCKED`, show `ethics.reason`. **Do not** match or negotiate.
4. Else snapshot identity and open:

```ts
task.ethics = ethics;
task.originalStructured = structured; // freeze at first ALLOW / ALLOW_WITH_CONDITIONS
task.status = "OPEN";
```

### Edit compose card

```ts
const amendment = await reviewAmendment(originalStructured, proposedStructured);
if (amendment.verdict === "REJECT") {
  // keep originalStructured / last allowed structured
} else {
  // save proposed
}
```

Price / ETA edits do **not** need this — they are not job amendments.

### `nextMove`

Bargain **only on price**. Optional `amendments` for same-job tweaks (color). **Do not** call `arbitrateMove` inside `nextMove`. Divya’s loop referees.

---

## Divya — matching + live negotiate (`agent/` and `market-maker/`)

Blocked tasks must never be offered. Package pickups will not pass `reviewTask`.

### Gate a new task (if you create tasks outside Thomas)

`POST` to the Gotchu Next app (or import if you are in `gotchu/`):

```http
POST /api/ethics/review
Content-Type: application/json

{ "structured": { "title": "...", "category": "food", "maxPriceUsd": 12 } }
```

Response: `{ "ok": true, "data": { "verdict": "ALLOW" | "ALLOW_WITH_CONDITIONS" | "BLOCK", "reason": "...", ... } }`

If `BLOCK`, do not outreach.

### Referee each offer / counter (required)

Once per turn, **before** you send or save:

```http
POST /api/ethics/arbitrate
Content-Type: application/json

{
  "originalStructured": { },
  "currentStructured": { },
  "role": "worker_agent",
  "proposed": {
    "priceUsd": 12,
    "etaMinutes": 20,
    "rationale": "Can do it for $12.",
    "accept": false,
    "amendments": []
  },
  "transcript": []
}
```

| `data.verdict` | You do |
|---|---|
| `ALLOW` | Send/save the move. Use `data.structured` if they tweaked the same job. |
| `STRIP_AMENDMENTS` | Send **price / ETA / accept only**. Keep the original job. |
| `REJECT_MOVE` | Do not save. Retry that side once, then skip. |
| `BLOCK_TASK` | Stop. No approval. |

`market-maker/src/lib/market/ethics-gate.ts` is still a stub that always allows. Replace it with a call to `reviewTask` / `arbitrateMove` (or the HTTP above). Do not leave the stub as the real gate.

If the Gotchu app is on another port, point `ETHICS_BASE_URL` at it (e.g. `http://localhost:3000`).

---

## Will — onboarding / completion / ethics UI

You **do not** own the model.

- `components/ethics/*` (badge, blocked card) stay yours. They already take `EthicsVerdict`.
- After a star-rating comment:

```ts
import { reviewComment } from "@/lib/agents/ethics";

const ethicsFlag = await reviewComment(comment); // category string or null
```

Set `ethicsFlag` on the review doc. Do not add a $50 money cap. Do not treat package pickup as allow-with-conditions.

---

## Function cheat sheet

| Function | Who | When |
|---|---|---|
| `reviewTask(structured)` | Thomas (Divya if she creates tasks) | Before `OPEN` |
| `reviewAmendment(original, proposed)` | Thomas | Compose field edits |
| `arbitrateMove(input)` | **Divya’s loop only** | Each offer/counter |
| `reviewComment(comment)` | Will | After a review comment |

HTTP (same behavior, for `agent/` / `market-maker`):

- `POST /api/ethics/review`
- `POST /api/ethics/amendment`
- `POST /api/ethics/arbitrate`

Bodies and responses use `{ ok: true, data }` / `{ ok: false, error }`.

---

## Demo

1. Food run or “paint my fence navy” → allowed (maybe conditions for tutoring / private home).
2. “Write my 15-213 lab for $50” → **BLOCK** (academic integrity).
3. “Pick up my package at the UC” → **BLOCK** (credential / ID).
4. Optional: navy color allowed; “also write my essay” stripped; agents only trade dollars.

Questions: Daphne. Types fights: Will still decides shared shapes — ask before adding fields to `task` / `user`.
