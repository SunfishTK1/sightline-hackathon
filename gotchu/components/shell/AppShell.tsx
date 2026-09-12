/**
 * @owner Will
 * @shared true — nav, header, availability toggle
 */
import Link from "next/link";
import { AvailabilityToggle } from "./AvailabilityToggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-[var(--page)] text-[var(--ink)]">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Gotchu
          </Link>
          <Link href="/compose" className="text-muted-foreground hover:text-foreground">
            Compose
          </Link>
          <Link href="/feed" className="text-muted-foreground hover:text-foreground">
            Feed
          </Link>
          <Link href="/onboarding" className="text-muted-foreground hover:text-foreground">
            Onboarding
          </Link>
        </nav>
        <AvailabilityToggle />
      </header>
      {children}
    </div>
  );
}
