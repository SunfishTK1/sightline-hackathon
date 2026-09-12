# Site navigation policy

One canonical page. No separate login screen. This is the intended shape
of the web app going forward — written down so it doesn't drift back into
a landing page + login page + account page split.

## The one real page: `/onboarding`

`https://gotchu-web-production.up.railway.app/onboarding` is the correct
link for everything:

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

`gotchu-web-production.up.railway.app/` redirects straight to
`/onboarding` (`gotchu/app/page.tsx`). It used to be a landing page with
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

## Custom domain check needed

`gotchu.velroi.com` was flagged as showing something different from
`gotchu-web-production.up.railway.app/onboarding`. If that domain is a
custom-domain alias pointed at the same Railway service, this fix carries
over automatically on the next deploy. If it's pointing at a different or
stale deployment, that's a Railway domain-configuration check outside
what a code change can fix — worth confirming in Railway's dashboard
under the custom domains setting for this service.
