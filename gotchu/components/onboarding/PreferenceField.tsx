/** @owner Will */
"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function PreferenceField({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <Label htmlFor="preferenceText">What are you usually up for?</Label>
      <Textarea
        id="preferenceText"
        name="preferenceText"
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="I'm usually around Gates and Tepper on weekday afternoons. Happy to do food runs and package pickups, not moving furniture. Min $8."
        required
      />
      <p className="text-sm text-muted-foreground">
        Your agent negotiates from this, in your words. Say what you will not do, too.
      </p>
    </div>
  );
}
