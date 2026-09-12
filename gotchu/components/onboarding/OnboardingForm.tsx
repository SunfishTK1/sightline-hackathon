/** @owner Will */
"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { PhoneField } from "./PhoneField";
import { PhotoField } from "./PhotoField";
import { TermsDialog } from "./TermsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneMask } from "@/lib/phone";
import {
  onboardingSchema,
  type OnboardingInput,
} from "@/lib/validate";
import type { UserConsents } from "@/lib/types/user";

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

export function OnboardingForm({ existing }: { existing: ExistingProfile | null }) {
  const [savedUuid, setSavedUuid] = useState<string | null>(existing?.uuid ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [emailVerified, setEmailVerified] = useState(existing?.emailVerified ?? false);

  // While a submission is pending Auth0's verification-email click,
  // poll our own profile so a link clicked on another device (phone,
  // another tab) flips this screen without a manual refresh.
  useEffect(() => {
    if (!savedUuid || emailVerified) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/me");
        const json = (await res.json()) as { data?: { user?: { emailVerified?: boolean } | null } };
        if (json.data?.user?.emailVerified) {
          setEmailVerified(true);
          toast.success("Email confirmed. You're in.");
        }
      } catch {
        // ignore transient errors; next tick retries
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [savedUuid, emailVerified]);

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      firstName: existing?.firstName ?? "",
      lastName: existing?.lastName ?? "",
      phone: existing ? formatPhoneMask(existing.phone) : "",
      cmuEmail: existing?.cmuEmail ?? "",
      acceptedTerms: existing?.consents.acceptedTerms ?? false,
      ageConfirmed: existing?.consents.age18 ?? false,
      consentCall: existing?.consents.canCall ?? false,
      consentText: existing?.consents.canText ?? false,
      consentLikeness: existing?.consents.canUseLikeness ?? false,
      photoDataUrl: existing?.photoDataUrl,
    },
  });

  async function onSubmit(values: OnboardingInput) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          user: {
            uuid: string;
            firstName: string;
            lastName: string;
            phone: string;
            cmuEmail: string;
            photoDataUrl?: string;
          };
          needsVerification: boolean;
          wasExisting: boolean;
          phoneChanged: boolean;
        };
        error?: string;
      };
      if (!json.ok || !json.data?.user) {
        toast.error(json.error ?? "Could not save profile");
        return;
      }
      const { user, needsVerification, wasExisting, phoneChanged } = json.data;
      setSavedUuid(user.uuid);
      setEmailVerified(!needsVerification);
      window.dispatchEvent(new Event("gotchu:user-updated"));
      form.reset({
        firstName: user.firstName,
        lastName: user.lastName,
        phone: formatPhoneMask(user.phone),
        cmuEmail: user.cmuEmail,
        acceptedTerms: true,
        ageConfirmed: true,
        consentCall: true,
        consentText: true,
        // The public user omits consents, so keep what they just chose. The
        // other two are hardcoded true only because they are required to join.
        consentLikeness: values.consentLikeness ?? false,
        photoDataUrl: user.photoDataUrl,
      });
      if (needsVerification && wasExisting) {
        toast.success(
          phoneChanged
            ? `Updated — we'll reach you at ${formatPhoneMask(user.phone)}. Confirm the new email we just sent to keep using Gotchu.`
            : "Updated — confirm the new email sent from Auth0 to keep using Gotchu.",
        );
      } else if (needsVerification) {
        toast.success("Check your CMU inbox to confirm your email.");
      } else {
        toast.success("You're in.");
      }
    } catch {
      toast.error("Could not save profile");
    } finally {
      setSubmitting(false);
    }
  }

  const errors = form.formState.errors;

  const fieldClass =
    "!h-11 !rounded-xl !border-[var(--border)] !bg-white !px-3.5 !text-base !shadow-none";

  return (
    <form className="space-y-9" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            autoComplete="given-name"
            className={fieldClass}
            {...form.register("firstName")}
          />
          {errors.firstName ? (
            <p className="text-sm text-destructive">{errors.firstName.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            autoComplete="family-name"
            className={fieldClass}
            {...form.register("lastName")}
          />
          {errors.lastName ? (
            <p className="text-sm text-destructive">{errors.lastName.message}</p>
          ) : null}
        </div>
      </div>

      <PhotoField
        value={form.watch("photoDataUrl")}
        onChange={(next) => form.setValue("photoDataUrl", next, { shouldValidate: true })}
        error={errors.photoDataUrl?.message}
      />

      <div className="space-y-2">
        <Label htmlFor="cmuEmail">School email</Label>
        <Input
          id="cmuEmail"
          type="email"
          autoComplete="email"
          placeholder="you@andrew.cmu.edu"
          className={fieldClass}
          {...form.register("cmuEmail")}
        />
        <p className="text-xs text-muted-foreground">
          Must end in @andrew.cmu.edu
        </p>
        {errors.cmuEmail ? (
          <p className="text-sm text-destructive">{errors.cmuEmail.message}</p>
        ) : null}
      </div>

      <PhoneField
        value={form.watch("phone")}
        onChange={(next) => form.setValue("phone", next, { shouldValidate: true })}
        error={errors.phone?.message}
        inputClassName={fieldClass}
      />

      <fieldset className="space-y-4 border-t border-[var(--ink)]/10 pt-7">
        <legend className="mb-1 text-sm font-medium text-[var(--ink)]">
          You&apos;ll need to agree to the first three
        </legend>
        <div className="space-y-1">
          {/*
            The dialog trigger is a sibling of the label, not nested inside
            it - a <button> inside a <label for="acceptedTerms"> made the
            checkbox toggle unpredictably on click (browsers don't agree on
            whether a click on nested interactive content should also fire
            the label's default "activate the associated control" behavior).
          */}
          <div className="flex items-start gap-3 text-sm text-[var(--ink)]">
            <input
              id="acceptedTerms"
              type="checkbox"
              checked={form.watch("acceptedTerms")}
              onChange={(event) =>
                form.setValue("acceptedTerms", event.target.checked, { shouldValidate: true })
              }
              className="mt-0.5 size-4 accent-[var(--broker)]"
            />
            <span>
              <label htmlFor="acceptedTerms">I have read and agree to the</label>{" "}
              <TermsDialog
                onAgree={() => form.setValue("acceptedTerms", true, { shouldValidate: true })}
                onDecline={() => form.setValue("acceptedTerms", false, { shouldValidate: true })}
              />
            </span>
          </div>
          {errors.acceptedTerms ? (
            <p className="text-sm text-destructive">{errors.acceptedTerms.message}</p>
          ) : null}
        </div>
        <ConsentCheck
          id="ageConfirmed"
          label="I am 18 or older"
          checked={form.watch("ageConfirmed")}
          onChange={(next) => form.setValue("ageConfirmed", next, { shouldValidate: true })}
          error={errors.ageConfirmed?.message}
        />
        <ConsentCheck
          id="consentCall"
          label="Gotchu can call me at this number"
          checked={form.watch("consentCall")}
          onChange={(next) => form.setValue("consentCall", next, { shouldValidate: true })}
          error={errors.consentCall?.message}
        />
        <ConsentCheck
          id="consentText"
          label="Gotchu can text me at this number"
          checked={form.watch("consentText")}
          onChange={(next) => form.setValue("consentText", next, { shouldValidate: true })}
          error={errors.consentText?.message}
        />
        <ConsentCheck
          id="consentLikeness"
          label="Optional: Gotchu can use my profile photo to picture me in the images and short videos it makes about tasks. Leave this off and a generic figure is used instead. You can turn it off later by texting the agent."
          checked={form.watch("consentLikeness") ?? false}
          onChange={(next) => form.setValue("consentLikeness", next, { shouldValidate: true })}
          error={errors.consentLikeness?.message}
        />
      </fieldset>

      <Button
        type="submit"
        disabled={submitting}
        className="!h-12 w-full !rounded-xl !text-base sm:w-auto sm:!px-8"
      >
        {submitting ? "Saving…" : savedUuid ? "Update my info" : "Join Gotchu"}
      </Button>
    </form>
  );
}

function ConsentCheck({
  id,
  label,
  checked,
  onChange,
  error,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="flex items-start gap-3 text-sm text-[var(--ink)]"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--broker)]"
        />
        <span>{label}</span>
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
