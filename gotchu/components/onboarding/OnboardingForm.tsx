/** @owner Will */
"use client";

import { PreferenceField } from "./PreferenceField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingForm() {
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        // TODO(Will): POST /api/onboarding
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone (E.164)</Label>
        <Input id="phone" name="phone" placeholder="+14125550123" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cmuEmail">CMU email</Label>
        <Input id="cmuEmail" name="cmuEmail" readOnly placeholder="prefilled from Auth0" />
      </div>
      <PreferenceField />
      <Button type="submit">Save profile</Button>
    </form>
  );
}
