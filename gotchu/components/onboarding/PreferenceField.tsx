/** @owner Will */
"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PreferenceField() {
  return (
    <div className="space-y-2">
      <Label htmlFor="preferenceText">What are you usually up for?</Label>
      <Textarea
        id="preferenceText"
        name="preferenceText"
        rows={5}
        placeholder="I'm usually around Gates and Tepper on weekday afternoons. Happy to do food runs and package pickups, not moving furniture. Min $8."
        required
      />
    </div>
  );
}
