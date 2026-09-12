/** @owner Will */
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { getIdentity } from "@/lib/identity";
import { findUserByAuth0Sub, refreshEmailVerification } from "@/lib/users";

export default async function OnboardingPage() {
  const identity = await getIdentity();
  const found = identity ? await findUserByAuth0Sub(identity.auth0Sub) : null;
  const existing = found ? await refreshEmailVerification(found) : null;

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
      <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink)]">
        Join Gotchu
      </h1>
      <p className="mt-4 max-w-[42ch] text-lg leading-relaxed text-muted-foreground">
        For CMU students only. Gotchu matches you with a student nearby who
        can get something done — fill this out once, then everything else
        (asking, getting matched, agreeing on a price) happens over text.
      </p>
      <div className="my-9 h-px bg-[var(--ink)]/10" />
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
    </main>
  );
}
