# Onboarding + Auth0 email verification — what changed, and how to run it

This covers the onboarding flow work: Auth0-backed email verification, moving
onboarding's storage from the `users` table to the real `people` table, profile
photo upload, the Next.js 16 `proxy.ts` migration, and the onboarding page
redesign.

## TL;DR for teammates pulling this branch

1. Copy the new env vars below into your own `gotchu/.env.local` (ask Will
   for the actual values — nothing secret is in this file or in git).
2. Run `npm install` (added `@auth0/nextjs-auth0`, no other new deps).
3. Run `npm run migrate:people` once against the Railway DB (idempotent —
   safe to run again, does nothing if columns already exist).
4. `npm run dev` and hit `/onboarding`.

If `AUTH0_M2M_CLIENT_ID`/`AUTH0_M2M_CLIENT_SECRET` aren't set, onboarding
still works — it just skips real email verification (logs a console
warning and marks the email verified locally). Everything else works the
same either way.

## Env vars (`gotchu/.env.local`)

```
APP_BASE_URL=http://localhost:3000
AUTH0_DOMAIN=gotcmu.us.auth0.com
AUTH0_CLIENT_ID=...           # "Gotchu CMU" Regular Web App — login flow
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=...              # session cookie encryption key

AUTH0_M2M_CLIENT_ID=...       # "Gotchu CMU (M2M)" — Management API access
AUTH0_M2M_CLIENT_SECRET=...
AUTH0_DB_CONNECTION=Username-Password-Authentication

DATABASE_URL=postgresql://...  # Railway Postgres, already shared with the
                                # texting/matching backend
```

Ask Will for the actual values — do not commit them, and don't paste them
into chat/PR descriptions.

### Why two Auth0 apps

- **"Gotchu CMU"** (Regular Web App) — only used if/when someone actually
  logs in via Auth0's hosted redirect (`/auth/login`). Not required for
  onboarding itself.
- **"Gotchu CMU (M2M)"** (Machine to Machine, authorized for the **Auth0
  Management API** with `read:users`, `create:users`, `update:users`) —
  what the onboarding backend actually uses. On submit, it creates (or
  finds) a database-connection Auth0 user for that email and asks Auth0 to
  send its own verification email. No user ever logs into this app; it's
  server-to-server only.

## How email verification works

1. Onboarding form submits to `POST /api/onboarding`.
2. The server looks up/creates an Auth0 user for that email via the
   Management API (`lib/auth0-management.ts`). **Every submission
   re-demands confirmation, not just the first** — if Auth0 already has
   this email marked verified from an earlier click, the server explicitly
   flips it back to unverified (`setAuth0EmailUnverified`, a Management
   API `PATCH`) and then asks Auth0 to send a fresh verification email
   (`jobs/verification-email`). The `people` row is saved with
   `doc.emailVerified: false` on every single onboarding POST when Auth0
   is configured — editing your phone number or name always means
   reconfirming your email afterward, by design.
3. There's no callback route — Auth0's default verify-email page doesn't
   redirect back into our app. Instead, `emailVerified` is checked lazily:
   `lib/users.ts:refreshEmailVerification()` calls the Management API
   (`GET /users/:id`) whenever `/api/me` or the onboarding page loads, and
   flips the flag once Auth0 reports the (latest) link was clicked.
4. While a submission is pending, `OnboardingForm.tsx` polls `/api/me`
   every 4s (only while the tab is open and unverified) so the person sees
   it flip without a manual refresh.
5. `PATCH /api/me/availability` is gated on `emailVerified` — you can't go
   "available" with an unconfirmed email, and that includes right after
   you've just edited your profile.

Auth0's default sending domain sometimes lands in spam on a fresh tenant.
The quick fix is marking the first email "not spam"; the real fix is
wiring a custom email provider under Branding → Email Provider.

## Storage: `people`, not `users`

**`users` is test/seed data — nothing in onboarding writes to it anymore.**
The real identity table, already used by the texting/matching backend
(`worker_profiles`, `orders`, `payments`, `calls`, `agent_handoffs` all FK
to it), is `people`:

```
people(
  id               uuid primary key default gen_random_uuid(),
  phone            text unique not null,
  display_name     text,
  email            text unique,        -- added by this change
  avatar_data_url  text,               -- added by this change
  doc              jsonb not null,     -- added by this change
  created_at       timestamptz not null,
  updated_at       timestamptz not null -- added by this change
)
```

`npm run migrate:people` (`scripts/migrate-people-onboarding.ts`) adds the
four new columns — additive only, doesn't touch existing rows or other
tables. Safe to re-run.

`doc` (jsonb) holds everything that isn't a real column: `auth0Sub`,
`firstName`, `lastName`, `emailVerified`, `emailVerifiedAt`,
`preferenceText`, `preferenceEmbedding`, `consents`, `availability`,
`stats`. `display_name` is `firstName + " " + lastName`.

### Identity key: CMU email, not phone or name

A CMU student's `@andrew.cmu.edu` address can't change, so it's the only
thing "is this the same person re-registering?" is decided by
(`lib/users.ts:upsertUser`):

- Submitting again with the **same email** always updates that same
  `people` row (new phone, corrected name, etc. all just overwrite it) —
  it never creates a duplicate registration. The API response includes
  `wasExisting` and `phoneChanged` so the UI can say "updated your info"
  / "we'll reach you at the new number now" instead of pretending it's a
  fresh join.
- If the email doesn't match anything yet, but the **phone** already
  belongs to a bare contact stub with no email (someone the texting agent
  already knows about but who never onboarded), onboarding claims that
  same row rather than violating the phone's unique constraint or
  creating a second person.
- If the phone is already tied to a **different, already-verified email**,
  the submission is rejected with `409` — that's a real conflict, not the
  same person, and the app won't silently merge them.

## Profile photo

Onboarding now has an optional photo upload (`components/onboarding/PhotoField.tsx`).

**Why it's collected — and this is stated to the user in the form's own
copy, not hidden**: the photo isn't shown publicly anywhere yet. It's raw
material for a planned feature — generating an animated version of the
person once a task resolves (either doing the task, or having one done for
them). If that never ships, it's still a normal profile photo; nothing
about collecting it depends on the feature existing yet.

How it's handled:

- Resized client-side (canvas, capped at 512px on the long edge, JPEG
  quality 0.85) before it ever leaves the browser, then sent as a
  `data:image/jpeg;base64,...` string in the onboarding POST body. No
  object storage (S3, Railway volume, etc.) needed for the hackathon.
- Validated both client- and server-side: must be PNG/JPEG/WEBP, capped at
  `MAX_PHOTO_DATA_URL_LENGTH` (900,000 chars ≈ 660KB decoded) —
  `lib/validate.ts`.
- Stored as its own column, `people.avatar_data_url` — not nested inside
  `doc`, so it's easy to query/exclude separately later if it needs to
  move to real object storage.
- Optional and sticky: leaving it out of a resubmission (e.g. just
  updating your phone number) keeps whatever photo was already saved —
  `upsertUser` only overwrites it when a new one is actually sent
  (`lib/users.ts`).

If this needs to move to real object storage (S3/R2/Railway volumes) before
it's used for image generation, `avatar_data_url` is the only column that
would change — nothing else in the schema depends on how the photo is
stored.

### Known gap, not yet reconciled

`PATCH /api/me/availability` still writes to `people.doc.availability`,
which is a different field from `worker_profiles.is_available` — the one
the actual matching pipeline reads. Nothing in the current onboarding flow
depends on `people.doc.availability` in the UI anymore (the header toggle
was removed), but if anything starts relying on it, it should probably be
pointed at `worker_profiles` instead.

## Other changes in this pass

- **`middleware.ts` → `proxy.ts`**: Next.js 16 deprecated the `middleware`
  file convention and renamed it to `proxy` (same behavior, new file/export
  name — see `node_modules/next/dist/docs/.../proxy.md`). Nothing else
  needed to change.
- **`AppShell.tsx`**: removed the top nav entirely (no more Gotchu logo
  link, Compose, Feed, Join, Log in/out, availability toggle). The web app
  is just the onboarding/join form; everything else happens over text with
  the agent.
- **Onboarding page**: removed the UUID display and the "confirm your
  email" banner (feedback now surfaces via toast only), redesigned
  spacing/typography/inputs to match the existing brand palette in
  `gotchu-hackathon-spec.md` §9 (market/dispatch feel — no cards, no
  gradients, left-aligned).

## Useful scripts

```
npm run migrate:people    # add email/doc/updated_at/avatar_data_url to people (idempotent)
npm run test:onboarding   # schema + phone/email validation checks
                          # (set ONBOARDING_TEST_URL to also hit a live API)
npm run create-schema     # legacy — creates the old `users`-style schema
                          # from the original spec; not used by anything
                          # live anymore, kept for reference
```
