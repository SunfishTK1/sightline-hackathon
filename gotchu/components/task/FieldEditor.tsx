/** @owner Thomas */
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FieldEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
