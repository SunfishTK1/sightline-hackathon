/** @owner Will (onboarding form) / @owner Claude (returning-visitor account view) */
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { AccountOrForm } from "@/components/onboarding/AccountOrForm";
import { getIdentity } from "@/lib/identity";
import { findUserByAuth0Sub, refreshEmailVerification } from "@/lib/users";
import { getRequestHistory, getWorkHistory, getWalletSummary } from "@/lib/history";

export default async function OnboardingPage() {
  const identity = await getIdentity();
  const found = identity ? await findUserByAuth0Sub(identity.auth0Sub) : null;
  const existing = found ? await refreshEmailVerification(found) : null;

  // A verified returning visitor gets their account (history + balance)
  // straight away - the httpOnly cookie set the first time they onboarded
  // is the only "login" there is, and it already proves a real, confirmed
  // CMU email. Anyone still mid-verification, or brand new, sees the form.
  const showAccount = Boolean(existing?.emailVerified);
  const history = showAccount
    ? await (async () => {
        const [requests, work, wallet] = await Promise.all([
          getRequestHistory(existing!.uuid),
          getWorkHistory(existing!.uuid),
          getWalletSummary(existing!.uuid),
        ]);
        return { requests, work, wallet };
      })()
    : null;

  return (
    <main
      className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6 sm:py-16"
      style={
        {
          "--ring": "var(--broker)",
          "--border": "color-mix(in oklch, var(--ink) 16%, transparent)",
        } as React.CSSProperties
      }
    >
      {showAccount ? null : (
        <>
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink)]">
            Join Gotchu
          </h1>
          <p className="mt-4 max-w-[42ch] text-lg leading-relaxed text-muted-foreground">
            For CMU students only. Gotchu matches you with a student nearby who
            can get something done — fill this out once, then everything else
            (asking, getting matched, agreeing on a price) happens over text.
          </p>
          <div className="my-9 h-px bg-[var(--ink)]/10" />
        </>
      )}
      {showAccount && existing && history ? (
        <AccountOrForm
          existing={{
            uuid: existing.uuid,
            firstName: existing.firstName,
            lastName: existing.lastName,
            cmuEmail: existing.cmuEmail,
            phone: existing.phone,
            emailVerified: existing.emailVerified,
            photoDataUrl: existing.photoDataUrl,
            consents: existing.consents,
          }}
          history={history}
        />
      ) : (
        <OnboardingForm
          existing={
            existing
              ? {
                  uuid: existing.uuid,
                  firstName: existing.firstName,
                  lastName: existing.lastName,
                  cmuEmail: existing.cmuEmail,
                  phone: existing.phone,
                  emailVerified: existing.emailVerified,
                  photoDataUrl: existing.photoDataUrl,
                  consents: existing.consents,
                }
              : null
          }
        />
      )}
    </main>
  );
}
