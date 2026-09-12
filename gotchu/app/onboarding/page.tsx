/** @owner Will */
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { buttonVariants } from "@/components/ui/button";
import { getIdentity } from "@/lib/identity";
import { getSignupStatus, marketConfigured } from "@/lib/market";
import { cn } from "@/lib/utils";

export default async function OnboardingPage() {
  const identity = await getIdentity();

  // Nothing to fill in until we know who is filling it in.
  if (!identity) redirect("/auth/login?returnTo=/onboarding");

  if (!identity.isCmu) {
    return (
      <main className="mx-auto w-full max-w-lg px-6 py-12">
        <h1 className="mb-2 text-3xl font-semibold">CMU students only</h1>
        <p className="mb-8 text-muted-foreground">
          You signed in as {identity.email || "an account with no email"}, which is not a CMU
          address. Sign in with your andrew.cmu.edu account to join.
        </p>
        <Link href="/auth/logout" className={cn(buttonVariants({ variant: "outline" }))}>
          Sign out and try again
        </Link>
      </main>
    );
  }

  const existing = marketConfigured()
    ? await getSignupStatus(identity.sub).catch(() => null)
    : null;

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-12">
      <h1 className="mb-2 text-3xl font-semibold">
        {existing?.phone_verified ? "Your profile" : "Welcome to Gotchu"}
      </h1>
      <p className="mb-8 text-muted-foreground">
        Tell us who you are and what you&apos;re usually up for — your agent negotiates from this.
      </p>
      <OnboardingForm
        email={identity.email}
        suggestedName={identity.name}
        existing={
          existing
            ? {
                phone: existing.phone,
                display_name: existing.display_name,
                phone_verified: existing.phone_verified,
                blurb: existing.blurb,
                categories: existing.categories,
                min_price_usd: existing.min_price_usd,
              }
            : null
        }
      />
      {existing?.phone_verified && (
        <p className="mt-6 text-sm text-muted-foreground">
          {existing.phone} is verified. You have made {existing.requests_made}{" "}
          {existing.requests_made === 1 ? "request" : "requests"} and taken {existing.jobs_taken}{" "}
          {existing.jobs_taken === 1 ? "job" : "jobs"}.
        </p>
      )}
    </main>
  );
}
