# Gotchu — 24-Hour Build Spec

**"Need something?" → "Gotchu."**

A text-first task marketplace for verified CMU students. You type what you need in plain English; your personal AI agent structures it, an **ethics and arbitration agent** (The Word / Academic Integrity) gates it and referees the deal, a market-making agent finds candidates and negotiates with *their* agents, and humans only come back in to approve the deal.

**Team:** Will (onboarding + auth + completion) · Thomas (personal AI agent) · Divya (market-making: matching + live negotiate loop in `agent/`) · Daphne (ethics + arbitration; web feed / approval UI)

**Ethics addendum:** `ethics-arbitration-spec.md`. Price is the only thing agents exchange. Same-job tweaks are allowed. Package pickup is **BLOCKED** (needs someone else's ID). No dollar cap. Daphne owns the agent; others call her functions.

---

## 0. The one thing that decides whether this ships

Four people, 24 hours, one codebase. The failure mode is not "the agents weren't smart enough" — it's that at hour 18 nobody's pieces fit together. So:

**Hours 0–2 are for contracts, not features.** Everyone agrees on the Mongo documents, the state machine, and the API routes. Then everyone builds behind a mock and integrates against real data at T+8.

Ship rule: every workstream must have a hardcoded fallback. If the LLM call fails at demo time, the route returns a canned-but-valid object. Judges never see a stack trace.

---

## 1. Locked stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router) + TypeScript | One repo, API routes and UI together, one Vercel deploy |
| UI | Tailwind + shadcn/ui | Fast, and we control the look (see §9) |
| Auth | Auth0 | CMU email gating happens in an Action, not our code |
| DB | MongoDB Atlas + **Atlas Vector Search** | This is the sponsor play (see §2) |
| Agents | Claude API with tool use / structured JSON output | Three agents, one shared client |
| Embeddings | **Gemini `text-embedding-004`** (768 dims) | Same job as OpenAI's, and it qualifies us for the Gemini prize (§2) |
| Voice | **ElevenLabs** on the negotiation replay | Cheap, and it improves the best screen we have (§2) |
| Payments | Solana devnet, feature-flagged off | Prize target, but last in (§8) |
| Deploy | Vercel + Atlas free tier | No infra work |

Repo: `gotchu/` — single Next.js app. No microservices. No separate Python backend. Everything is a route handler.

---

## 2. Sponsor prize strategy

HackCMU runs six MLH sponsor prizes: **Gemini API, ElevenLabs, Solana, Vultr, Auth0, MongoDB Atlas.** Each is awarded per team member, and they stack with the main HackCMU judging — so they're close to free upside, *as long as chasing them doesn't degrade the core product.* That's the trade to keep in mind: a team that bolts on six APIs and wins none of the main prizes has lost.

Gotchu already touches two of them without adding a line of code. We're targeting **four, with Solana as a fifth**, and deliberately skipping one.

### The ranking, by value per hour of work

**1. Auth0 — target hard. This is our best fit at the whole event.**
The Auth0 prize page specifically points at *Auth0 for AI Agents*, and Gotchu is almost a textbook case for it: agents act on a user's behalf, within a delegated limit, and escalate to a human at the boundary. We don't have to bolt anything on — we have to *name* what we already built.

Frame it this way in the writeup and the pitch: the personal agent holds delegated authority up to the user's reservation price; anything outside that envelope requires human approval, which is exactly what the approval card in §4 enforces. Plus the Post-Login Action doing domain-verified CMU gating with custom claims.

→ **Will**: read the Auth0 for AI Agents docs during your T+2→T+6 block, not as an afterthought. If there's a token-vault or async-authorization primitive that maps onto our approval step in under an hour, use it. If not, the framing alone is still strong.

**2. MongoDB Atlas — we qualify the moment we connect.**
Correcting an earlier draft of this doc: the MLH bar here is literally "build a hack using MongoDB Atlas." There's no hidden requirement to use exotic features. We qualify at T+2.

Vector search still matters, but for a different reason — it's the tiebreaker when eight other teams also "used MongoDB." Our three talking points:
1. **Atlas Vector Search** — preference text embedded at onboarding; `$vectorSearch` over worker vectors *is* the matching engine, not a bolt-on.
2. **Aggregation pipeline as the ranking layer** — vector score, rating, and experience combined in one round trip.
3. **Change Streams** — live task pool. Only if it's free (§12 cut list).

→ **Divya** presents this. Get the `$50 student credit` or free tier at T+0.

**3. Gemini — a one-file change.**
Swap `lib/embed.ts` from OpenAI to Gemini's `text-embedding-004`. Same interface, same call site, and it legitimately qualifies us. **Note the dimension change: 768, not 1536** — update the Atlas vector index definition in §3 to match, or the index silently rejects your vectors.

If we want a second, more visible Gemini surface: run the ethics/arbitration agent on Gemini and the personal/negotiation agents on Claude. That's defensible on the merits (a cheap fast classifier vs. a reasoning-heavy negotiator) and gives a better answer than "we swapped one API call" when a judge asks why.

→ **Will** owns `embed.ts`. **Daphne** owns ethics (`lib/agents/ethics.ts`, handbook distill, deny-list).

**4. ElevenLabs — the rare integration that makes the project better.**
TTS on the negotiation replay: two distinct voices reading the agents' one-line rationales as the transcript plays. It's ~45 minutes on a screen Daphne is already building, and it turns our best demo moment into something people remember. Pre-generate the audio when the negotiation resolves, cache the URLs on the offer doc, play on reveal.

Optional second surface if there's slack: voice intake on the compose screen — hold to speak, transcribe, feed the same `parseTask`. Text-first is still the product; voice is an accessibility affordance, not a pivot.

→ **Daphne**, at T+16, only after the approval flow works. Feature-flag it.

**5. Solana — the real decision, and the only one that costs us.**
Ledger Nano S Plus per team member, and the prize framing calls out consumer payments and high-frequency transactions, which is precisely what a campus micropayment market is. See §8 for scope.

This is the only prize on the list that trades against core polish, so it gets committed last. If we're on schedule at the T+14 checkpoint, pull it forward from T+20. If we're not, cut it without debate.

**6. Vultr — skip.**
We're on Vercel. Contorting deployment for a sixth prize is how teams lose the grand prize chasing swag.

### What this means for the submission form

MLH prizes are claimed per-challenge on the submission, and teams lose them by forgetting to tick the box. At T+22, when Will fills the form: tick **Auth0, MongoDB, Gemini, ElevenLabs**, plus **Solana** if it shipped. Write one sentence per prize explaining the integration — judges skim, and "we used it" loses to "we used it *for this*."

---

## 3. Data model

Five collections. Mongo is schemaless, so add fields freely — but **never rename or remove** the ones marked 🔒, because other people's code reads them.

### `users`

```js
{
  _id: ObjectId,
  uuid: "usr_9f2a...",          // 🔒 our stable ID, used everywhere instead of _id
  auth0Sub: "auth0|abc123",     // 🔒 from Auth0 JWT sub claim
  firstName: "Will",            // 🔒 real name, verified via CMU email
  lastName: "…",                // 🔒
  cmuEmail: "…@andrew.cmu.edu", // 🔒 unique index
  phone: "+14125550123",        // 🔒 E.164 format, always
  preferenceText: "I'm usually around Gates and Tepper on weekday afternoons. Happy to do food runs and package pickups, not moving furniture. Min $8.",
  preferenceEmbedding: [0.013, ...],  // 768 floats (Gemini text-embedding-004)
  availability: { isAvailable: true, until: ISODate },
  stats: { tasksCompleted: 0, tasksRequested: 0, avgRating: null, ratingCount: 0 },
  createdAt: ISODate,
  updatedAt: ISODate
}
```

`preferenceText` is the star. It's free-text, it's what gets embedded, and it's what the personal agent reads to negotiate on someone's behalf. Onboarding should push people to write 2–3 sentences, not check boxes.

### `tasks`

```js
{
  _id: ObjectId,
  taskId: "tsk_4b81...",        // 🔒
  requesterUuid: "usr_...",     // 🔒
  rawText: "I need someone to pick up my package from the UC and bring it to Gates before 6. Max $10.",
  structured: {                 // 🔒 produced by the personal agent
    title: "Package pickup: UC → Gates",
    category: "pickup",         // pickup | food | moving | errand | tutoring_allowed | other
    pickupLocation: "Cohon University Center",
    dropoffLocation: "Gates Hillman Center",
    deadline: ISODate,
    maxPriceUsd: 10,
    estimatedMinutes: 25,
    requirements: ["Requester must provide package pickup authorization"]
  },
  taskEmbedding: [ ... ],
  ethics: {                     // 🔒 written by the ethics agent
    verdict: "ALLOW",           // ALLOW | ALLOW_WITH_CONDITIONS | BLOCK
    categories: [],
    conditions: [],
    reason: "Routine campus errand, no integrity or safety concerns.",
    reviewedAt: ISODate
  },
  status: "OPEN",               // 🔒 see §4
  matchedWorkerUuid: null,
  agreedPriceUsd: null,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

### `offers` — one doc per negotiation between a task and a candidate worker

```js
{
  _id: ObjectId,
  taskId: "tsk_...",            // 🔒
  workerUuid: "usr_...",        // 🔒
  matchScore: 0.83,
  transcript: [                 // 🔒 agent-to-agent messages, this is the demo money shot
    { round: 1, from: "worker_agent", priceUsd: 14, etaMinutes: 20, rationale: "…", accept: false, at: ISODate },
    { round: 1, from: "requester_agent", priceUsd: 9,  etaMinutes: 30, rationale: "…", accept: false, at: ISODate },
    { round: 2, from: "worker_agent", priceUsd: 11, etaMinutes: 22, rationale: "…", accept: false, at: ISODate },
    { round: 2, from: "requester_agent", priceUsd: 11, etaMinutes: 22, rationale: "…", accept: true,  at: ISODate }
  ],
  outcome: "AGREED",            // PENDING | AGREED | FAILED | WITHDRAWN
  finalPriceUsd: 11,
  createdAt: ISODate
}
```

### `agreements`

```js
{
  _id: ObjectId,
  taskId: "tsk_...",
  requesterUuid: "usr_...",
  workerUuid: "usr_...",
  finalPriceUsd: 11,
  terms: ["Deliver to Gates 4th floor by 5:45pm", "Requester covers any pickup fee"],
  requesterApprovedAt: ISODate,
  workerApprovedAt: ISODate,
  payment: { method: "cash", solanaTxSig: null, status: "unpaid" },
  createdAt: ISODate
}
```

### `reviews`

```js
{
  _id: ObjectId,
  taskId: "tsk_...",
  raterUuid: "usr_...",
  ratedUuid: "usr_...",
  rating: 5,                    // 1–5
  surveyAnswers: { onTime: true, asDescribed: true, wouldRepeat: true },
  comment: "…",
  ethicsFlag: null,             // set by ethics agent if the comment describes a violation
  createdAt: ISODate
}
```

### Indexes — run these in hour 1

```js
db.users.createIndex({ cmuEmail: 1 }, { unique: true })
db.users.createIndex({ uuid: 1 }, { unique: true })
db.users.createIndex({ auth0Sub: 1 }, { unique: true })
db.tasks.createIndex({ taskId: 1 }, { unique: true })
db.tasks.createIndex({ status: 1, createdAt: -1 })
db.offers.createIndex({ taskId: 1, workerUuid: 1 }, { unique: true })
```

Atlas Vector Search index on `users`, named `user_pref_vec` (create in the Atlas UI → Search → Create Index → JSON editor):

```json
{
  "fields": [
    { "type": "vector", "path": "preferenceEmbedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "availability.isAvailable" },
    { "type": "filter", "path": "uuid" }
  ]
}
```

Filter fields **must** be declared in the index or `$vectorSearch` filters silently fail. This burns people. Declare them now.

---

## 4. Task state machine

This is the spine. Every route transitions status, every UI reads status, nobody invents a new value.

```
DRAFT ──► ETHICS_REVIEW ──► BLOCKED
                │
                └──► OPEN ──► MATCHING ──► NEGOTIATING ──► PENDING_APPROVAL ──► ACCEPTED
                                  │              │                  │
                                  └── NO_MATCH ◄─┘                  └──► DECLINED ──► OPEN
                                                                                        
ACCEPTED ──► IN_PROGRESS ──► COMPLETED ──► REVIEWED
```

Owner of each transition:
- `DRAFT → ETHICS_REVIEW → OPEN|BLOCKED` — Will
- `OPEN → MATCHING → NEGOTIATING` — Divya
- `NEGOTIATING → PENDING_APPROVAL|NO_MATCH` — Daphne
- `PENDING_APPROVAL → ACCEPTED|DECLINED` — Daphne (human approval UI)
- `ACCEPTED → COMPLETED → REVIEWED` — Will (survey + rating writes back to `users.stats`)

---

## 5. API contract (frozen at T+2)

All routes are `app/api/**/route.ts`. All return `{ ok: true, data }` or `{ ok: false, error }`. All auth'd routes read the Auth0 session and resolve `uuid` server-side — never trust a uuid from the client body.

| Route | Owner | Body → Response |
|---|---|---|
| `POST /api/onboarding` | Will | `{firstName, lastName, phone, preferenceText}` → `{user}` — creates user, embeds preference |
| `PATCH /api/me/availability` | Will | `{isAvailable, until?}` → `{user}` |
| `POST /api/tasks` | Thomas | `{rawText}` → `{task}` — parses to `structured`, then calls ethics internally |
| `POST /api/ethics/review` | Daphne | `{taskId}` *or* `{structured}` → `{verdict, categories, conditions, reason}` — Thomas calls the **function**, not HTTP |
| `POST /api/ethics/amendment` | Daphne | `{original, proposed}` → `{verdict, sameTask, allowedChanges, rejectedChanges, reason}` |
| `POST /api/ethics/arbitrate` | Daphne | move + original/current structured → `{verdict, structured, stripped, reason}` — Divya's `agent/` loop may HTTP this |
| `POST /api/tasks/:taskId/match` | Divya | `{}` → `{candidates: [{uuid, matchScore, reasons[]}]}` — sets status `MATCHING` |
| `POST /api/tasks/:taskId/negotiate` | Divya (live loop in `agent/`; web stub may remain) | `{workerUuid}` → `{offer}` |
| `POST /api/offers/:offerId/approve` | Daphne | `{role: "requester"\|"worker"}` → `{agreement?}` |
| `POST /api/tasks/:taskId/complete` | Will | `{}` → `{task}` |
| `POST /api/tasks/:taskId/review` | Will | `{rating, surveyAnswers, comment}` → `{review}` |
| `GET /api/feed` | Daphne | → `{tasks[]}` — open task pool, polled every 3s (upgrade to change stream if time) |

Shared types live in `lib/types.ts` and **Will writes that file first**, in hour 1, before anything else. Everyone imports from it.

---

## 6. The three agents

One shared client in `lib/agent.ts` that takes a system prompt + user message and returns parsed JSON. Every agent call must: (a) request JSON only, (b) strip markdown fences before parsing, (c) validate with zod, (d) fall back to a safe default on failure.

### 6a. Personal AI agent — Thomas

Two jobs, two prompts.

**Job 1 — intake.** Raw text → `structured`. Ask for nothing back from the user unless a required field is genuinely missing; if `deadline` or `maxPriceUsd` is absent, infer a sensible default and mark it `inferred: true` so the UI can show "assumed $10 — tap to change."

```
You convert a CMU student's casual request into a structured task.
Campus locations: Cohon University Center (UC), Gates Hillman (GHC), Tepper,
Wean, Doherty, Hunt Library, Morewood, Mudge, Resnik, Schatz, Craig St, Forbes Ave.
Return ONLY a JSON object matching this schema: { ... }
If price is unstated, estimate a fair student rate for the effort and set inferred:true.
Never invent a deadline more than 7 days out.
```

**Job 2 — negotiate.** Given the task, the principal's `preferenceText`, a role (`requester_agent` or `worker_agent`), and the transcript so far, produce the next message. Each side has a private reservation price the other never sees:
- requester reservation = `structured.maxPriceUsd`
- worker reservation = parsed from their `preferenceText` (e.g. "min $8"), default $7

Rules the prompt must enforce: never exceed your reservation; concede at most 30% of the gap per round; accept if the other side's offer is within your reservation; be brief (one sentence of rationale).

### 6b. Market-making agent — Divya (match + `agent/` negotiate); Daphne referees via `arbitrateMove`

Not one big prompt. It's **a database query plus a bounded loop**, with an LLM only in the tie-break.

```js
// Divya: the ranking pipeline
db.users.aggregate([
  { $vectorSearch: {
      index: "user_pref_vec",
      path: "preferenceEmbedding",
      queryVector: taskEmbedding,
      numCandidates: 200,
      limit: 25,
      filter: { "availability.isAvailable": true }
  }},
  { $match: { uuid: { $ne: requesterUuid } } },
  { $addFields: {
      vectorScore: { $meta: "vectorSearchScore" },
      ratingScore: { $ifNull: [ { $divide: ["$stats.avgRating", 5] }, 0.7 ] },
      experienceScore: { $min: [ { $divide: ["$stats.tasksCompleted", 10] }, 1 ] }
  }},
  { $addFields: { finalScore: { $add: [
      { $multiply: ["$vectorScore", 0.6] },
      { $multiply: ["$ratingScore", 0.25] },
      { $multiply: ["$experienceScore", 0.15] }
  ]}}},
  { $sort: { finalScore: -1 } },
  { $limit: 5 },
  { $project: { preferenceEmbedding: 0, auth0Sub: 0, phone: 0 } }
])
```

Never return `phone` or `auth0Sub` to the client. Ever.

### 6c. Ethics and arbitration agent — Daphne

Full contract: `ethics-arbitration-spec.md`. Policy is a **distilled** Student Handbook (“The Word”) + Academic Integrity Policy in `gotchu/lib/prompts/ethics-handbook.ts` (not a dump of the full handbook).

**Ethics (gate)** — every task before it hits the pool, and every review comment after. Deny-list prefilter then heuristics/LLM.

**Arbitration (referee)** — Divya's negotiate loop (and any web `nextMove` loop) calls `arbitrateMove` **once per turn**. Rules:
- **Price is the only thing exchanged.** ETA may ride along. No dollar cap.
- **Same job may flex** (paint the fence navy instead of white).
- **Job identity may not change** (paint the fence ↛ write my lab). Snapshot `originalStructured` at first ALLOW.

Output of the gate:

```json
{
  "verdict": "ALLOW | ALLOW_WITH_CONDITIONS | BLOCK",
  "categories": ["academic_integrity", "controlled_substances", "physical_safety",
                 "credential_misuse", "harassment", "illegal", "financial_risk", "none"],
  "conditions": ["Tutoring may explain concepts only — do not complete graded work."],
  "reason": "One sentence to the student, citing The Word when blocking.",
  "confidence": 0.0
}
```

Gate rubric:
- **BLOCK** — graded work done *for* them (unauthorized assistance); **package pickup** (needs the other person's ID — false ID / misrepresentation / unauthorized access credentials); alcohol/tobacco/controlled substances; impersonation / “use my ID”; illegal; meaningful physical danger.
- **ALLOW_WITH_CONDITIONS** — private residence; tutoring (*concept explanation* only, not *doing the work*).
- **ALLOW** — food runs, moving help, errands, event help, same-job work like painting a fence.

Arbitration verdicts per turn: `ALLOW` | `STRIP_AMENDMENTS` | `REJECT_MOVE` | `BLOCK_TASK`.

Demo tip: block “write my 15-213 lab for $50” (Academic Integrity) **and** “pick up my package at the UC” (credential). Happy path is a food run or fence paint, not package pickup. Optional beat: navy fence allowed, “also write my essay” stripped.

---

## 7. Who does what, hour by hour

Assume T+0 is kickoff. Adjust to your actual clock.

### Will — onboarding, auth, completion, review loop

**T+0 → T+2 (shared setup, you lead it)**
1. `npx create-next-app@latest gotchu --ts --tailwind --app --eslint`
2. `npx shadcn@latest init`, then `npx shadcn@latest add button card input textarea form label badge dialog tabs avatar separator skeleton sonner scroll-area slider select`
3. Push to GitHub, add all three as collaborators, connect Vercel. Everyone works on branches off `main`, small PRs, no one commits directly.
4. Write `lib/types.ts` with every interface from §3 and the status union from §4. Push it. **Tell the group it's live.**
5. Write `lib/mongo.ts` (cached client promise — the Next.js hot-reload pattern, not a new client per request) and `lib/agent.ts` (the shared JSON-mode LLM call).
6. Create the Atlas cluster, the indexes, and the vector index. Share the connection string in the team channel.
7. Seed script: `scripts/seed.ts` — 25 fake CMU students with real-sounding `preferenceText` and precomputed embeddings. **Divya cannot test matching without this. It is your highest-priority deliverable after types.**

**T+2 → T+6 — Auth0 + onboarding**
8. Auth0 tenant → new Regular Web App → install `@auth0/nextjs-auth0`, wire `middleware.ts` and the auth routes.
9. Post-Login Action, in the Auth0 dashboard:

```js
exports.onExecutePostLogin = async (event, api) => {
  const email = (event.user.email || "").toLowerCase();
  const isCmu = /@(andrew\.)?cmu\.edu$/.test(email);
  if (!isCmu || !event.user.email_verified) {
    return api.access.deny("Gotchu is open to verified CMU students only.");
  }
  api.idToken.setCustomClaim("https://gotchu.app/cmu_verified", true);
  api.idToken.setCustomClaim("https://gotchu.app/cmu_email", email);
};
```

10. `/onboarding` page: shadcn `Form` + zod. Fields exactly: first name, last name, phone (E.164, mask the input), CMU email (read-only, prefilled from the token — this is the verification story), and a big textarea for `preferenceText` with a placeholder that models a good answer.
11. `POST /api/onboarding` — generate `uuid`, embed `preferenceText`, upsert on `auth0Sub`, return the user. Re-embed on every preference edit (`PATCH /api/me`).
12. Availability toggle in the header — one switch, writes `availability.isAvailable`. Divya's filter depends on it.

**T+6 → T+12 — ethics UI (Daphne owns the agent)**
13. Daphne owns `reviewTask` / `reviewAmendment` / `arbitrateMove` (`ethics-arbitration-spec.md`). You do not rewrite the rubric.
14. UI: a `Badge` on every task card showing the verdict. `BLOCK` renders a card explaining why, in the agent's own words, with a "revise request" button. `components/ethics/` stays yours.
15. Logging to `ethics_log` is Daphne's unless she asks you to wire Mongo.

**T+12 → T+18 — completion loop**
16. `POST /api/tasks/:id/complete` and the post-task survey dialog (3 toggles + 1–5 stars + optional comment).
17. Write the rating back to `users.stats` with `$inc` and a recomputed average — in one `findOneAndUpdate`, don't read-modify-write.
18. Run the comment through Daphne's `reviewComment`; set `ethicsFlag` if it describes a violation. This closes the "rates jobs and staff" box on the whiteboard.

**T+18 → T+24** — integration, demo dry runs, README. You own the README because you own the types.

---

### Thomas — personal AI agent

**T+0 → T+2** — Help Will get the repo up. Get your API key working. Write one throwaway script that calls the model and parses JSON, so you know the plumbing works before you build on it.

**T+2 → T+8 — intake**
1. `lib/agents/personal.ts`, export `parseTask(rawText, user) → StructuredTask`.
2. Prompt per §6a. Feed it the campus location list — grounding it in real building names is what makes the demo feel like it's *for CMU* rather than generic.
3. Zod-validate the output. On parse failure, retry once with the error message appended; on second failure, return a minimal task with `needsReview: true`.
4. `POST /api/tasks`: parse → embed `structured.title + description` → call Daphne's `reviewTask()` → snapshot `originalStructured` on ALLOW → set status `OPEN` or `BLOCKED` → insert. Return the task. On later field edits, call `reviewAmendment(original, proposed)` before saving. Package pickup will BLOCK — don't use it as the happy-path demo.
5. Build the compose UI: one big textarea, a send button, and then the **structured card that appears underneath** showing what your agent understood, with every field editable inline. That reveal is the core interaction of the product — spend design time on it.

**T+8 → T+16 — negotiation brain**
6. Export `nextMove({task, principalPreferenceText, role, transcript, reservationPrice}) → NegotiationMessage`.
7. Parse the reservation price out of `preferenceText` with a cheap LLM call at match time, cached on the offer doc. Default to $7 if absent.
8. Enforce the concession rules in *code*, not just the prompt — clamp the returned price to `[reservation bounds]` before saving. Models will cheerfully agree to $3.
9. Coordinate with Divya: her `agent/` loop (and any web negotiate stub) calls your `nextMove`, then **Daphne's** `arbitrateMove` before append. Bargain **only on price**. Optional same-job `amendments`. Agree signatures at T+8 and don't change them after.

**T+16 → T+20** — Polish the rationale text. It's what the audience reads on screen during the negotiation replay, so it should sound like a person's agent ("Will's usually free around then, but 20 minutes each way is worth more than $9"), not a JSON field.

**T+20 → T+24** — Freeze. Write three demo tasks that reliably produce good parses and rehearse them.

---

### Divya — market-making: matching engine

**T+0 → T+2** — Set up Atlas access with Will. Read §2 twice; you're the one presenting the MongoDB story.

**T+2 → T+8 — get vector search working on seed data**
1. Confirm Will's seed script has run and `preferenceEmbedding` is populated on all 25 users. If it hasn't, write it yourself — don't wait.
2. Build the vector index (§3). Verify in the Atlas UI that it's `ACTIVE` before debugging anything else.
3. Write `lib/agents/market.ts` → `findCandidates(task) → Candidate[]` using the pipeline in §6b. Test it in a scratch route with a hardcoded task before touching the real flow.
4. Sanity check: a task about food should surface the seeded users whose preference text mentions food runs. If it doesn't, your embedding of the *task* is probably including boilerplate — embed only the meaningful text.

**T+8 → T+14 — ranking + explanation**
5. Add the weighted `finalScore`. Tune the weights against seed data until the top result is obviously right to a human.
6. For each candidate, generate a one-line `reason` ("Does package pickups, usually near Gates, 4.8★ over 12 tasks"). Cheap LLM call over the top 5 only, or template it from the fields — templating is faster and fine.
7. `POST /api/tasks/:taskId/match` → sets `MATCHING`, returns top 5, then the live negotiate loop in `agent/` (auto-counter / auto-accept on price). Call Daphne's `arbitrateMove` (or `POST /api/ethics/arbitrate`) before sending an offer/counter. Do not offer package-pickup tasks — they never pass the gate.
8. Handle `NO_MATCH`: fewer than 1 candidate above a score floor → status `NO_MATCH`, UI offers to broaden the task.

**T+14 → T+20 — the demo artifact**
9. Build the **matching visualization**: a panel showing the 5 candidates with their score breakdown as small stacked bars (vector / rating / experience). This is the screen where you say "that's Atlas Vector Search ranking 25 students in one aggregation." Make it look good.
10. Add the sponsor line to the README with the actual pipeline code in it.

**T+20 → T+24** — Integration with Daphne's ethics HTTP + Thomas's `nextMove`, then rehearse your 30 seconds of the pitch.

---

### Daphne — ethics + arbitration (standalone first)

Contract: `ethics-arbitration-spec.md`. Build in `gotchu/lib/agents/ethics.ts`. Branch: `daphne/ethics-arbitrate`.

The live haggle loop is **Divya's** (`agent/` `autoNegotiate`). Do not treat `gotchu/lib/agents/negotiate.ts` as your job; leave the stub unless the team deletes it later. You still own web **feed / approval / replay UI** if those screens stay in Next.js.

**T+0 → T+6 — ethics + arbitration**
0. Types, deny-list (include package pickup → `credential_misuse`), distilled The Word (`ethics-handbook.ts`), the 8 canned tests, `npm run ethics-smoke`.
1. `reviewTask`, `reviewAmendment`, `arbitrateMove`, `reviewComment`. Routes under `/api/ethics/*`.
2. Tell Thomas: call `reviewTask` / `reviewAmendment`. Tell Divya: call `arbitrateMove` once per offer/counter (HTTP from `agent/` is fine). Tell Will: call `reviewComment`; keep the badge UI.

**Then — feed / approval / replay (web)**
3. `/feed`, approval card, transcript replay as before if those screens are still yours. Ethics badge data comes from your verdicts.

**T+20 → T+24** — Integration + rehearsal. Demo happy path = food/fence, not package pickup.

---

## 8. Solana (prize target — commit at the T+14 checkpoint, not before)

Feature-flag it: `NEXT_PUBLIC_ENABLE_SOLANA=false` until it works.

**The decision rule:** at T+14, if the core loop runs end-to-end with real agents, Daphne or Thomas takes this — whoever is further ahead. If the core loop is still limping, nobody touches it and we drop the prize. Do not let two people start it "just in case."

Minimum viable version, ~90 minutes:
- `@solana/wallet-adapter-react` + `@solana/wallet-adapter-wallets`, Phantom only, **devnet**.
- On agreement approval, if both users have a wallet connected, send `finalPriceUsd` converted at a hardcoded rate as a plain SOL transfer from requester → worker, with a memo containing the `taskId`.
- Store `solanaTxSig` on the agreement, render a Solscan devnet link.

What **not** to do in 24 hours: write an Anchor escrow program. Say "escrow is the next step" in the pitch instead — describing the design is worth almost as much as a half-broken program, and costs nothing.

---

## 9. Design direction

Don't ship default shadcn slate. Ten minutes of theming is the difference between "hackathon project" and "product."

**Palette** — a market/dispatch feel, not a SaaS dashboard:
- `#F2F4F3` page base (cool pale grey-green)
- `#16201C` ink — text and the negotiation panel background
- `#1F5C3A` broker green — agreements, matched states, primary buttons
- `#E8C547` hold gold — pending approval, negotiating
- `#B3321E` stop red — ethics blocks only, nowhere else

**Type** — General Sans (or Geist) for everything, with tabular numerals on prices and timers so they don't jitter as they update. Numbers are the personality of this product: set prices noticeably larger than surrounding text and let them carry the hierarchy.

**Principle** — the app is a text thread with a broker, not a listings site. Left-aligned, generous line height, no hero image, no gradient. Spend all the visual energy on one place: the negotiation replay. Everything else stays deliberately plain so that screen lands.

Copy: buttons say what happens (`Approve $11 deal`, not `Submit`). Empty task pool says `Nothing open right now. Post something and we'll find you someone.` Ethics blocks explain and offer a revision, never just deny.

---

## 10. Integration checkpoints — put these in a shared timer

| Time | Gate | Everyone stops until it passes |
|---|---|---|
| **T+2** | `lib/types.ts`, Mongo connected, seed data in, repo deployed | Yes |
| **T+8** | End-to-end with mocks: raw text → structured → ethics → 5 candidates → fake negotiation | Yes |
| **T+14** | Real agents wired, one full task completes with real LLM calls | Yes |
| **T+18** | **Feature freeze.** Nothing new after this line | Yes |
| **T+20** | Full demo rehearsal, start to finish, on the deployed URL | Yes |
| **T+22** | Second rehearsal + README + submission form filled | Yes |

Submit the devpost/form at T+22, not T+23:59. Every year a team loses on a submission deadline.

---

## 11. Demo script (3 minutes)

1. **(15s)** "Every CMU student needs small things done and every CMU student has gaps in their day. The friction isn't finding people — it's the negotiating. So we removed the humans from the middle and left them at the ends." Show the landing screen.
2. **(20s)** Log in with a real `@andrew.cmu.edu` account. Show the Auth0 gate rejecting a gmail address. "Everyone here is a verified CMU student, with their real name — and their agent only has authority up to a limit they set."
3. **(25s)** Type a food run or “paint my fence navy” in plain English. The structured card resolves underneath it. "Thomas's agent turned that sentence into a task."
4. **(20s)** The bad tasks: "write my 15-213 lab, $50" (Academic Integrity) and optionally UC package pickup (needs someone else's ID). Blocked, with The Word in the reason. "Every task passes an ethics agent before it's ever visible."
5. **(35s)** Matching panel. "25 students, one Atlas Vector Search aggregation, ranked on preference similarity, rating and history." Show the score bars.
6. **(45s)** The negotiation replay — let it play, with audio. Don't talk over the first few seconds. Then: "Neither student is on their phone right now. Their agents are doing this."
7. **(20s)** Both approvals, agreement card, completion + rating. "Humans come back exactly once: to say yes."
8. **(20s)** Close on what's next: Solana escrow, embeddings that update from completed-task history, campus-wide rollout. "Need something? Gotchu."

Rehearse it twice. Record a backup video at T+21 in case the deploy dies.

---

## 12. Cut list, in order

If you're behind, cut from the bottom up. Decide *now* so nobody defends their feature at 4am.

1. Vultr — never started, nothing to cut
2. Solana — cut first among things we started
3. ElevenLabs voice intake (keep the negotiation TTS if it works — it's 5 lines once the pipeline exists)
4. Change streams → keep polling
5. Multi-candidate negotiation → negotiate with the top candidate only
6. Post-task survey → keep the star rating only
7. Availability window → boolean toggle only
8. Score-breakdown bars → plain numbers

**Never cut:** onboarding + auth, structured task parsing, ethics gating (including `arbitrateMove` even if the UI only shows the initial BLOCK), vector matching, the negotiation replay. Those five are the product.

---

## 13. Setup

`.env.local` — Will creates it, shares via DM, and it goes in `.gitignore` immediately:

```
AUTH0_SECRET=
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
MONGODB_URI=
MONGODB_DB=gotchu
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=          # Gemini: embeddings + ethics agent
ELEVENLABS_API_KEY=
NEXT_PUBLIC_ENABLE_SOLANA=false
NEXT_PUBLIC_ENABLE_VOICE=false
```

Mirror every one of these into Vercel's environment variables at T+2, not at T+20.

```bash
npm i mongodb @auth0/nextjs-auth0 @anthropic-ai/sdk @google/generative-ai zod nanoid date-fns
npm i @elevenlabs/elevenlabs-js   # T+16, Daphne
npm i @solana/web3.js @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets  # T+20 only
```

Branches: `will/*`, `thomas/*`, `divya/*`, `daphne/*`. PR into `main`, one reviewer, merge fast. Nobody sits on a branch for six hours.

---

## 14. Architecture

```mermaid
flowchart TD
  A[Onboarding form<br/>Auth0 + CMU email gate] --> B[User embedding<br/>preferenceText vectorized]
  B --> C[(users<br/>Atlas Vector Index)]
  D[Web app<br/>availability + compose] --> E[Personal AI agent<br/>parses + negotiates]
  E --> F{Ethics agent<br/>gate}
  F -->|BLOCK| G[Revise request]
  F -->|ALLOW| H[Market-making agent<br/>$vectorSearch + ranking]
  C --> H
  H --> I[Task pool<br/>open jobs]
  H --> J[Negotiation loop<br/>agent ↔ agent, max 3 rounds]
  J --> K[Human approval<br/>both sides]
  K --> L[Agreement<br/>cash now, Solana later]
  L --> M[Completion + survey]
  M --> F
  M --> C
```

Two changes from the whiteboard worth noting: the ethics agent (Daphne, The Word) now sits **inline** in the flow (a gate before the pool, a referee during the deal, plus a reviewer of completed work) rather than off to the side, and completion feeds ratings back into the user documents that matching reads — so the market actually gets better as it's used. That feedback loop is the thing to say out loud in the pitch.

---

## 15. File structure & ownership

The rule that prevents 90% of merge pain: **one file has one owner, and files are small enough that two people never need the same one.** If you find yourself opening a file with someone else's name next to it, post in the chat instead of editing.

```
gotchu/
├── app/
│   ├── layout.tsx                            ◆ SHARED — Will
│   ├── globals.css                           ◆ SHARED — Will (theme tokens, §9)
│   ├── page.tsx                              Will      landing + login CTA
│   ├── onboarding/page.tsx                   Will
│   ├── compose/page.tsx                      Thomas    the "type what you need" screen
│   ├── feed/page.tsx                         Daphne    open task pool
│   ├── tasks/[taskId]/page.tsx               Daphne    negotiation replay + approval
│   ├── tasks/[taskId]/matches/page.tsx       Divya     candidate ranking view
│   └── api/
│       ├── auth/[auth0]/route.ts             Will
│       ├── onboarding/route.ts               Will
│       ├── me/route.ts                       Will      PATCH profile + preference re-embed
│       ├── me/availability/route.ts          Will
│       ├── ethics/review/route.ts            Daphne
│       ├── ethics/amendment/route.ts         Daphne
│       ├── ethics/arbitrate/route.ts         Daphne
│       ├── feed/route.ts                     Daphne
│       ├── offers/[offerId]/approve/route.ts Daphne
│       └── tasks/
│           ├── route.ts                      Thomas    POST create, GET mine
│           └── [taskId]/
│               ├── route.ts                  Thomas    GET one, PATCH structured fields
│               ├── match/route.ts            Divya
│               ├── negotiate/route.ts        Daphne
│               ├── complete/route.ts         Will
│               └── review/route.ts           Will
│
├── components/
│   ├── ui/                                   ◆ shadcn-generated — NOBODY hand-edits
│   ├── shell/                                ◆ SHARED — Will (nav, header, availability toggle)
│   ├── onboarding/                           Will      OnboardingForm, PreferenceField
│   ├── ethics/                               Will UI   EthicsBadge, BlockedCard, ConditionsList
│   ├── task/                                 Thomas    ComposeBox, StructuredCard, FieldEditor
│   ├── match/                                Divya     CandidateList, ScoreBars, MatchReason
│   ├── negotiate/                            Daphne    TranscriptView, OfferLedger, ApprovalCard
│   └── feed/                                 Daphne    TaskCard, FeedList, EmptyState
│
├── lib/
│   ├── types/                                ◆ one file per entity — see note below
│   │   ├── user.ts                           Will
│   │   ├── task.ts                           Will
│   │   ├── offer.ts                          Daphne
│   │   ├── agreement.ts                      Daphne
│   │   ├── review.ts                         Will
│   │   ├── ethics.ts                         Daphne    verdicts + arbitration types
│   │   ├── match.ts                          Divya
│   │   └── status.ts                         Will      the status union + legal transitions
│   ├── mongo.ts                              Will      cached client
│   ├── db.ts                                 Will      typed collection accessors
│   ├── auth.ts                               Will      session → user, requireUser()
│   ├── llm.ts                                Will      shared JSON-mode call + zod validate
│   ├── embed.ts                              Will
│   ├── ids.ts                                Will      usr_ / tsk_ / ofr_ generators
│   ├── agents/
│   │   ├── personal.ts                       Thomas    parseTask, nextMove
│   │   ├── ethics.ts                         Daphne    reviewTask, reviewAmendment, arbitrateMove, reviewComment
│   │   ├── market.ts                         Divya     findCandidates
│   │   └── negotiate.ts                      leftover stub; live loop is agent/ (Divya)
│   └── prompts/                              one prompt per file, never a shared prompts.ts
│       ├── personal-intake.ts                Thomas
│       ├── personal-negotiate.ts             Thomas
│       ├── ethics-rubric.ts                  Daphne
│       ├── ethics-denylist.ts                Daphne
│       ├── ethics-arbitrate.ts               Daphne
│       ├── ethics-handbook.ts                Daphne    distilled The Word
│       └── match-explain.ts                  Divya
│
├── mocks/                                    delete before submission
│   ├── task.ts                               Thomas    a valid StructuredTask
│   ├── candidates.ts                         Divya     5 fake ranked candidates
│   ├── negotiation.ts                        leftover web ladder
│   └── ethics.ts                             Daphne    gate + amendment + arbitrate fixtures
│
├── scripts/
│   ├── seed.ts                               Will      25 users + embeddings
│   └── create-indexes.ts                     Will
│
├── middleware.ts                             ◆ Will
├── components.json                           ◆ shadcn config — Will only
├── tailwind.config.ts                        ◆ SHARED — Will
└── package.json                              ◆ SHARED — see dependency rule below
```

◆ = shared file. Changing one requires a message in the team chat first.

### Why `lib/types/` is a folder, not a file

Four people appending to one `types.ts` all night is the single most common source of conflicts in a hackathon repo. Split by entity, import from the exact path (`import type { Task } from "@/lib/types/task"`), and **do not create a barrel `index.ts`** — barrel files re-conflict every time anyone adds an export.

Will still writes the first version of every type file at T+1 so nobody is blocked. After that, the owner of each file owns it. Need a field on someone else's type? Ask; don't add it yourself.

### The four conflict hotspots, and the rule for each

| Hotspot | Rule |
|---|---|
| `package.json` / `package-lock.json` | Will installs **every** dependency in §13 and **every** shadcn component at T+0. If you genuinely need a new package: post in chat, install, commit *only* the lockfile change, push within 5 minutes. On conflict: `git checkout --theirs package-lock.json && npm install` |
| `components/ui/*` | Generated. Never hand-edit. Need a variant? Wrap it in your own folder |
| `globals.css` / `tailwind.config.ts` | Will sets the tokens at T+2 and they're frozen. Use the token, don't add a new one |
| `layout.tsx` / `components/shell/*` | Will only. Need a nav link? Ask him to add it |

### Git rules

- Branches: `will/onboarding`, `thomas/intake-agent`, `divya/vector-match`, `daphne/ethics-arbitrate`. One branch per feature, not one per person for the whole night.
- **Pull before every push:** `git pull --rebase origin main`. Rebase, not merge — the history stays readable and conflicts surface one commit at a time.
- Merge to `main` at least every 3 hours whether or not the feature is finished. Long-lived branches are how teams discover at hour 20 that two people rewrote the same route.
- PRs are for visibility, not gatekeeping — one glance, then merge. Nothing sits unmerged for more than 30 minutes.
- `main` must always deploy. If you break the Vercel build, fixing it is your only job until it's green.

### Ownership in one line each

- **Will** — everything under `lib/` that isn't an agent, `app/api/auth|onboarding|me`, `components/onboarding|ethics|shell`, both scripts, and the shared config. Integration owner: if two workstreams disagree about a shape, he decides. He **calls** Daphne's `reviewComment`; he does not own the ethics model.
- **Thomas** — `lib/agents/personal.ts`, `lib/prompts/personal-*`, `app/api/tasks/route.ts` + `[taskId]/route.ts`, `app/compose`, `components/task`. Calls `reviewTask` and `reviewAmendment`.
- **Divya** — `lib/agents/market.ts`, matching UI, Atlas index, and the live negotiate loop in `agent/`. Calls `arbitrateMove` (function or HTTP) once per offer/counter.
- **Daphne** — ethics + arbitration (`lib/agents/ethics.ts`, `lib/types/ethics.ts`, `lib/prompts/ethics-*`, `app/api/ethics/*`); web feed / approval / replay screens if still in Next.js.
