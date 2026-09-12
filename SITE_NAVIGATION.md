# Site navigation policy

One canonical page. No separate login screen. This is the intended shape
of the web app going forward — written down so it doesn't drift back into
a landing page + login page + account page split.

## The one real page: `/onboarding`

`https://gotchu.velroi.com/onboarding` is the correct link for
everything:

- First-time visitor → the join form (name, photo, email, phone, consents).
- Verified returning visitor → their account: railcoin balance, request
  history, work history, with "Edit your info" dropping back to the same
  form.

There is no separate "login" step to get the account view. The httpOnly
`gotchu_identity` cookie, set the moment someone finishes onboarding, is
the only session — and it's already gated behind a real Auth0-verified
`@andrew.cmu.edu` email (see `gotchu/app/onboarding/page.tsx`,
`gotchu/lib/identity.ts`, `gotchu/lib/history.ts`).

## `/` (root) is not a separate page

`gotchu.velroi.com/` redirects straight to `/onboarding`
(`gotchu/app/page.tsx`). It used to be a landing page with
its own "Log in" / "Log out" / "Join" buttons, wired to a second,
separate Auth0-hosted login flow (`/auth/login`, `/auth/logout`) that
duplicated what onboarding's cookie already does. That's gone - one page,
one link, no fork.

## Auth0 has exactly one job: the verification email

The only place Auth0 does anything user-facing is `POST /api/onboarding`
(`gotchu/app/api/onboarding/route.ts`): every time someone submits or
edits their account info, it re-demands confirmation by sending a fresh
verification email via Auth0's Management API, and the record is held
`emailVerified: false` until that link is clicked. That's it — there is
no hosted login page, no password, no separate "sign in" concept.

`/auth/login`, `/auth/logout`, and `getIdentity()`'s Auth0-session
fallback (`gotchu/lib/auth0.ts`, `gotchu/lib/identity.ts`) still exist in
the codebase but are **unlinked from every page** — nothing in the UI
points to them anymore. Left in place rather than deleted, since
`getIdentity()` still consults an Auth0 session as a secondary fallback
if one somehow exists; it is not exercised by any normal flow. If nothing
comes to depend on that fallback, it's a candidate for outright removal
later.

## Other pages that are intentionally separate

These existed before this policy and are not part of the account hub -
flag if that's wrong:

- `/compose` — a standalone task-composition page, no longer linked from
  anywhere (it was only reachable from the old home page). Still live at
  its URL, just orphaned from navigation.
- `/map`, `/feed` — cross-link each other (a demo campus map + live task
  feed), unrelated to accounts.

## Custom domain: resolved, and why it looked broken

`gotchu.velroi.com` was flagged as showing something different from the
railway.app host. It was not a stale or separate deployment — both
domains are attached to the same `gotchu-web` service and both served the
same build (checked with `railway domain -s gotchu-web`, and both
returned 200 on `/onboarding`).

The cause was one level down, and it is the same fork this document
exists to prevent. The session is the httpOnly `gotchu_identity` cookie,
set with no `domain` attribute, so the browser scopes it to the exact
host that issued it. Someone who onboarded on the railway.app host was a
stranger on `gotchu.velroi.com`: join form instead of their account, and
`/api/me/history` answering 401. Two hosts meant two cookie jars, so one
person had two identities depending on which URL they happened to open.

Fixed by making one host canonical. `gotchu.velroi.com` is it, matching
`APP_BASE_URL`, the wallet links voice-mcp mints, and the signup link the
agent hands out. `gotchu/proxy.ts` 308-redirects any other host to it,
preserving path, query, method and body. `CANONICAL_HOST` drives it; unset
means no redirect, so a misconfiguration can only ever be a no-op.

One consequence worth knowing: anyone who onboarded on the old host still
has their cookie stuck there and will land on the join form once. Their
data is intact — submitting the form again with the same CMU email claims
the existing `people` row rather than creating a second one.
