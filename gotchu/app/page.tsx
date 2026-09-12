/** @owner Will — landing + login CTA */
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm tracking-wide text-muted-foreground">CMU students only</p>
      <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink)]">Gotchu</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Need something? Type it. Your agent finds someone. You only approve the deal.
      </p>
      <div className="flex gap-3">
        <Link href="/api/auth/login" className={cn(buttonVariants())}>
          Log in with CMU email
        </Link>
        <Link href="/compose" className={cn(buttonVariants({ variant: "outline" }))}>
          Compose a task
        </Link>
      </div>
    </main>
  );
}
