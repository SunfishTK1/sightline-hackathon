/** @owner Will — landing + login CTA */
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getIdentity } from "@/lib/identity";
import { getSignupStatus, marketConfigured } from "@/lib/market";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const identity = await getIdentity();
  const account =
    identity && marketConfigured()
      ? await getSignupStatus(identity.sub).catch(() => null)
      : null;
  const signedUp = Boolean(account?.phone_verified);

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm tracking-wide text-muted-foreground">CMU students only</p>
      <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink)]">Gotchu</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Need something? Type it. Your agent finds someone. You only approve the deal.
      </p>
      <div className="flex flex-wrap gap-3">
        {!identity ? (
          <Link href="/auth/login" className={cn(buttonVariants())}>
            Log in with CMU email
          </Link>
        ) : signedUp ? (
          <Link href="/compose" className={cn(buttonVariants())}>
            Ask for something
          </Link>
        ) : (
          <Link href="/onboarding" className={cn(buttonVariants())}>
            Finish signing up
          </Link>
        )}
        <Link href="/feed" className={cn(buttonVariants({ variant: "outline" }))}>
          See open tasks
        </Link>
      </div>
      {identity && !signedUp && (
        <p className="max-w-md text-sm text-muted-foreground">
          You&apos;re signed in as {identity.email}. One more step: we need a phone number to text
          you at.
        </p>
      )}
    </main>
  );
}
