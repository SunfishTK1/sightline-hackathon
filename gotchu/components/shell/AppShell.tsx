/**
 * @owner Will
 * @shared true — nav, header, availability toggle
 */
import Link from "next/link";
import { AvailabilityToggle } from "./AvailabilityToggle";
import { getIdentity } from "@/lib/identity";
import { getSignupStatus, marketConfigured } from "@/lib/market";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const identity = await getIdentity();
  const account =
    identity && marketConfigured()
      ? await getSignupStatus(identity.sub).catch(() => null)
      : null;

  return (
    <div className="flex min-h-full flex-col bg-[var(--page)] text-[var(--ink)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
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
          {identity && (
            <Link href="/onboarding" className="text-muted-foreground hover:text-foreground">
              Profile
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-4 text-sm">
          {/* Only a verified worker has something to toggle. */}
          <AvailabilityToggle
            initial={account?.phone_verified ? Boolean(account.is_available) : null}
          />
          {identity ? (
            <>
              <span className="hidden text-muted-foreground sm:inline">{identity.email}</span>
              <Link href="/auth/logout" className="text-muted-foreground hover:text-foreground">
                Sign out
              </Link>
            </>
          ) : (
            <Link href="/auth/login" className="font-medium text-[var(--broker)] hover:underline">
              Log in
            </Link>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
