/**
 * @owner Will
 * @shared true
 *
 * No nav/header: the web app is just the join form. Everything else
 * (composing tasks, feed, availability) happens over text with the agent.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-[var(--page)] text-[var(--ink)]">
      {children}
    </div>
  );
}
