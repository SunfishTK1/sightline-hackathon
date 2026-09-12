# Merge log

A running log of what landed each time this agent pulled in and merged
teammates' work on `main`. Meant for other AI agents on this team (and
humans) to catch up on recent changes without re-reading diffs or git log.

Newest entries at the top. Each entry covers one pull/merge pass, not one
commit — several teammate commits often land between passes.

---

## 2026-09-12, later afternoon — ToS "Not yet" bug fix, likeness-consent audit

**What this agent added directly:**
- Fixed a real bug reported by a user testing onboarding: the ToS dialog's
  "Not yet" button closed the dialog without touching the `acceptedTerms`
  checkbox at all, so a previously-checked box stayed checked even after
  explicitly declining. `TermsDialog` now takes an `onDecline` prop that
  unchecks it. Also fixed the underlying cause of related checkbox
  flakiness: the dialog's trigger `<button>` was nested inside the
  checkbox's `<label>`, which produces inconsistent toggle behavior
  across browsers (nested interactive content inside a label is not a
  well-defined interaction). The trigger is now a sibling of the label,
  not nested inside it. See `gotchu/components/onboarding/{OnboardingForm.tsx,TermsDialog.tsx}`.
- Audited the "optional profile photo for AI-generated images/videos"
  consent (`canUseLikeness`, added in an earlier teammate commit): it is
  correctly optional and defaults to off end-to-end (schema, form,
  storage). However **nothing downstream currently reads this flag at
  all** - `agent/src/illustrate.ts` and `agent/src/video.ts` never use
  any person's actual photo today; generated images/videos only ever
  depict generic, unremarkable students. So there is nothing to violate
  right now, but if/when someone wires actual photo-based generation in,
  it must gate on this flag - it does not do so automatically just
  because the checkbox exists.

**Merged in from teammates during this pass:**
- Live match board deployed to the real domain; a settlement proof
  flow (`market-maker/src/app/api/live/event/route.ts`).
- Campus travel time tweaks (`market-maker/src/lib/market/campus-travel.ts`).
- A small voice-mcp server addition (3 lines, `voice-mcp/src/server.ts`).

**Conflicts resolved this pass:** none - clean merges.

---

## 2026-09-12, afternoon — wallet auto-provisioning, ToS + personalization, Auth0 diagnostics

**What this agent added directly:**
- Every phone number that calls or texts the personal agent now gets a
  devnet Solana wallet automatically, funded with 50 "railcoins" (framed
  to users as platform credit, backed 1:1 by devnet SOL — currently
  50,000 railcoins = 1 SOL, i.e. 0.001 SOL per new wallet). Wallets are
  created and funded via `voice-mcp/src/wallet.ts`, from a treasury
  wallet you fund yourself (`voice-mcp/scripts/create-treasury.ts`).
  Secret keys are encrypted at rest (AES-256-GCM).
- A real, scrollable, clickable Terms of Service
  (`gotchu/lib/terms.ts` + `TermsDialog.tsx`), now required at onboarding
  alongside (not replacing) the existing 18+/call/text consents. It
  discloses that using Gotchu means agent conversations are used to train
  and personalize the agents.
- The personal agent actually does that training: every ~8 messages it
  summarizes how a person writes (one sentence, from their own message
  history), embeds it (OpenAI `text-embedding-3-small`), and matches it
  against four fixed style archetypes (terse/warm/detailed/efficient) via
  cosine similarity. Stored in `person_style` (voice-mcp Postgres),
  folded into the system prompt on every future reply. See
  `agent/src/style.ts`, `voice-mcp/src/style.ts`.
- Auth0 email verification was silently no-op'ing in production (anyone
  onboarding got marked "verified" immediately, no email sent) whenever
  any of `AUTH0_DOMAIN` / `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET`
  / `AUTH0_CLIENT_ID` was unset - previously just a quiet `console.warn`.
  `gotchu/lib/auth0-management.ts` now has `missingAuth0EnvVars()`, and
  `app/api/onboarding/route.ts` logs loudly (`console.error`, names the
  missing var) and no longer treats an Auth0 API failure as "verified."
  **Root cause found**: these vars exist in `gotchu/.env.local` but were
  never added to the Railway `gotchu-web-production` service's env vars.

**Merged in from teammates during this pass** (chronological):
- Ethics-agent gate on live task quoting/evaluation; public live match
  board (`market-maker/.../live/`).
- Barter/non-USD payment blocking in the ethics denylist.
- Task video generation: film delivered to the requester too, one
  combined offer message instead of two.
- OpenStreetMap campus page with demo task pins (`gotchu/app/map`).
- Railcoin payouts on task completion; auto-park tasks nobody takes.
- Agent can text someone a link to their own wallet
  (`gotchu/app/w/[token]`, `voice-mcp/src/walletlink.ts`, `pay.ts`).
- Fixed the agent crash-looping in production: its start script required
  `.env.local`, which only exists locally, not in the Railway container
  (`--env-file=` → `--env-file-if-exists=`). This had silently stopped
  **all** outbound texting (outreach, nudges, replies) while other
  services stayed green.
- Site shipped in Geist instead of Times; a font-related build break
  fixed alongside it.
- Agent told where the signup page lives (for pointing new users there).

**Conflicts resolved this pass:** two — both additive (independent new
imports/lines in the same file from two branches), kept both sides. One
pre-existing TypeScript build break fixed along the way (`CampusMap.tsx`
narrowing `data` across an async closure boundary).

**Known open item:** the Auth0 fix above needs someone with Railway
dashboard access to actually add the four env vars to production - the
code fix only makes the failure loud, it can't set Railway's config.
