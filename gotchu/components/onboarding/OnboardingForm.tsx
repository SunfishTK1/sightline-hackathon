/**
 * @owner Will (Auth0 + signup wired by Thomas)
 *
 * Signup, in two steps. Step one creates the account and sends a code to the
 * number given; step two proves the number is theirs. The number matters more
 * here than an email does - it is the channel the agent actually uses - so it
 * is not trusted until a code comes back through it.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PreferenceField } from "./PreferenceField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The vocabulary the matcher already sorts work by. */
const CATEGORIES = [
  { id: "food", label: "Food runs" },
  { id: "pickup", label: "Pickups" },
  { id: "errand", label: "Errands" },
  { id: "moving", label: "Moving & lifting" },
  { id: "tutoring", label: "Tutoring" },
  { id: "design", label: "Design & making" },
  { id: "other", label: "Anything else" },
];

export type ExistingProfile = {
  phone: string;
  display_name: string | null;
  phone_verified: boolean;
  blurb: string | null;
  categories: string[] | null;
  min_price_usd: string | null;
} | null;

type Props = {
  email: string;
  suggestedName: string;
  existing: ExistingProfile;
};

export function OnboardingForm({ email, suggestedName, existing }: Props) {
  const router = useRouter();
  const [first = "", last = ""] = (existing?.display_name || suggestedName).split(" ");

  const [firstName, setFirstName] = useState(first);
  const [lastName, setLastName] = useState(last);
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [preferenceText, setPreferenceText] = useState(existing?.blurb ?? "");
  const [categories, setCategories] = useState<string[]>(existing?.categories ?? []);
  const [minPrice, setMinPrice] = useState(
    existing?.min_price_usd ? String(Math.round(Number(existing.min_price_usd))) : "",
  );
  const [wantsWork, setWantsWork] = useState(true);

  // "details" until the code is sent, then "code", then done.
  const [stage, setStage] = useState<"details" | "code">(
    existing && !existing.phone_verified ? "code" : "details",
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggle(id: string) {
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          phone,
          preferenceText,
          categories,
          minPriceUsd: minPrice ? Number(minPrice) : undefined,
          wantsWork,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(messageFor(json));
        return;
      }
      if (json.data?.verified) {
        router.push("/feed");
        return;
      }
      setStage("code");
      setNotice(
        json.data?.code_sent
          ? `We texted a six digit code to ${phone}.`
          : "Your account is saved, but the code could not be sent. Check the number and try again.",
      );
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message ?? messageFor(json));
        return;
      }
      router.push("/feed");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "code") {
    return (
      <form className="space-y-5" onSubmit={submitCode}>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <div className="space-y-2">
          <Label htmlFor="code">Six digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="font-mono text-lg tracking-[0.3em] tabular-nums"
            required
          />
          <p className="text-sm text-muted-foreground">
            Sent to {phone}. Until you enter it, nobody can offer you work.
          </p>
        </div>
        {error && <p className="text-sm text-[var(--stop)]">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Finish signing up"}
          </Button>
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setStage("details");
              setError(null);
              setNotice(null);
            }}
          >
            Wrong number?
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={submitDetails}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+1 412 555 0123"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <p className="text-sm text-muted-foreground">
          This is where your agent texts you. We send a code to check it is yours.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cmuEmail">CMU email</Label>
        <Input id="cmuEmail" name="cmuEmail" readOnly value={email} className="text-muted-foreground" />
      </div>

      <PreferenceField value={preferenceText} onChange={setPreferenceText} />

      <div className="space-y-2">
        <Label>What work will you take?</Label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = categories.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  on
                    ? "border-[var(--broker)] bg-[var(--broker)] text-white"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          Leave all of these off if you only want to ask for things, not do them.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="minPrice">Lowest you will work for</Label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">$</span>
          <Input
            id="minPrice"
            name="minPrice"
            inputMode="numeric"
            placeholder="8"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ""))}
            className="w-24 font-mono tabular-nums"
          />
          <span className="text-sm text-muted-foreground">
            Your agent will not take less without asking you.
          </span>
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          id="wantsWork"
          type="checkbox"
          checked={wantsWork}
          onChange={(e) => setWantsWork(e.target.checked)}
          className="mt-0.5 accent-[var(--broker)]"
        />
        <span className="text-muted-foreground">
          I am willing to be texted about jobs that match what I picked above. I can turn this off
          any time by replying STOP or from the header.
        </span>
      </label>

      {error && <p className="text-sm text-[var(--stop)]">{error}</p>}

      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : existing ? "Save and send me a code" : "Sign up"}
      </Button>
    </form>
  );
}

function messageFor(json: { error?: string; message?: string }): string {
  switch (json.error) {
    case "phone_in_use":
      return "That number already belongs to another account.";
    case "cmu_email_required":
      return "Gotchu is CMU only, and that email is not a CMU address.";
    case "market_not_configured":
    case "not_configured":
      return "The marketplace is not connected yet. Tell whoever is running the demo.";
    case "unreachable":
      return "The marketplace is not responding. Try again in a moment.";
    default:
      return json.message ?? json.error ?? "Something went wrong.";
  }
}
