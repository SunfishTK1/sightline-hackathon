/** @owner Will — landing + login CTA */
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getAuth0 } from "@/lib/auth0";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const session = (await getAuth0()?.getSession()) ?? null;

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm tracking-wide text-muted-foreground">CMU students only</p>
      <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink)]">Gotchu</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Need something? Type it. Your agent finds someone. You only approve the deal.
      </p>
      <div className="flex flex-wrap gap-3">
        {session?.user ? (
          <a href="/auth/logout" className={cn(buttonVariants({ variant: "outline" }))}>
            Log out {session.user.email}
          </a>
        ) : (
          <a href="/auth/login?returnTo=/onboarding" className={cn(buttonVariants())}>
            Log in with CMU email
          </a>
        )}
        <Link
          href={session?.user ? "/onboarding" : "/auth/login?returnTo=/onboarding"}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Join
        </Link>
        <Link href="/compose" className={cn(buttonVariants({ variant: "outline" }))}>
          Compose a task
        </Link>
      </div>
    </main>
  );
}
