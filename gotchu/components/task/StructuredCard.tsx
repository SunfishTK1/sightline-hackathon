/** @owner Thomas */
"use client";

import type { StructuredTask } from "@/lib/types/task";
import { FieldEditor } from "./FieldEditor";

export function StructuredCard({
  value,
  onChange,
}: {
  value: StructuredTask;
  onChange: (next: StructuredTask) => void;
}) {
  return (
    <div className="space-y-3 border border-border p-4">
      <p className="text-sm text-muted-foreground">Your agent understood:</p>
      <FieldEditor
        label="Title"
        value={value.title}
        onChange={(title) => onChange({ ...value, title })}
      />
      <FieldEditor
        label="Max price ($)"
        value={String(value.maxPriceUsd)}
        onChange={(v) => onChange({ ...value, maxPriceUsd: Number(v) || 0 })}
      />
      <FieldEditor
        label="Pickup"
        value={value.pickupLocation ?? ""}
        onChange={(pickupLocation) => onChange({ ...value, pickupLocation })}
      />
      <FieldEditor
        label="Dropoff"
        value={value.dropoffLocation ?? ""}
        onChange={(dropoffLocation) => onChange({ ...value, dropoffLocation })}
      />
    </div>
  );
}
