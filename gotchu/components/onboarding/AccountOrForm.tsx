/** @owner Claude */
"use client";

import { useState } from "react";
import { OnboardingForm } from "./OnboardingForm";
import { AccountOverview } from "@/components/account/AccountOverview";
import type { UserConsents } from "@/lib/types/user";
import type { TaskHistoryItem, WalletSummary } from "@/lib/history";

type ExistingProfile = {
  uuid: string;
  firstName: string;
  lastName: string;
  cmuEmail: string;
  phone: string;
  emailVerified: boolean;
  photoDataUrl?: string;
  consents: UserConsents;
};

type HistoryPayload = {
  requests: TaskHistoryItem[];
  work: TaskHistoryItem[];
  wallet: WalletSummary | null;
};

/**
 * A verified returning visitor sees their account (history + balance) by
 * default - no separate login, the identity cookie set at onboarding is
 * enough. "Edit your info" drops back to the same form a first-timer sees.
 */
export function AccountOrForm({
  existing,
  history,
}: {
  existing: ExistingProfile;
  history: HistoryPayload;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <AccountOverview
        firstName={existing.firstName}
        initial={history}
        onEdit={() => setEditing(true)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-sm underline underline-offset-2 text-muted-foreground hover:text-[var(--ink)]"
      >
        ← Back to your account
      </button>
      <OnboardingForm existing={existing} />
    </div>
  );
}
