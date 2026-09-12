/** @owner Claude */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The only "login" this app has: prove you own the CMU email already on
 * file and Auth0 re-sends the verification link. No password, no
 * re-onboarding - name, phone, and photo are untouched.
 */
export function RelinkForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding/relink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmuEmail: email }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast.error(json.error ?? "Could not find that account");
        return;
      }
      setSent(true);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Check your CMU inbox and click the link - this page will show your account once you do.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Label htmlFor="relinkEmail">Already have an account? Get back in.</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="relinkEmail"
          type="email"
          autoComplete="email"
          placeholder="you@andrew.cmu.edu"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="!h-11 flex-1 !rounded-xl !border-[var(--border)] !bg-white !px-3.5 !text-base !shadow-none"
        />
        <Button type="submit" variant="outline" disabled={submitting || !email} className="!h-11 !rounded-xl">
          {submitting ? "Sending…" : "Get back in"}
        </Button>
      </div>
    </form>
  );
}
