/** @owner Will */
"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PreferenceField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="preferenceText">What are you usually up for?</Label>
      <Textarea
        id="preferenceText"
        name="preferenceText"
        rows={5}
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        placeholder="I'm usually around Gates and Tepper on weekday afternoons. Happy to do food runs and package pickups, not moving furniture. Min $8."
      />
      <p className="text-xs text-muted-foreground">
        Your agent reads this to negotiate. Two or three sentences beat a list of checkboxes.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
