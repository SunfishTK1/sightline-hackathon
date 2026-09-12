/** @owner Will — E.164 masked phone input */
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhoneMask, toE164 } from "@/lib/phone";

export function PhoneField({
  id = "phone",
  value,
  onChange,
  error,
  inputClassName,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  inputClassName?: string;
}) {
  const e164 = toE164(value);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Phone</Label>
      <Input
        id={id}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+1 (412) 555-0123"
        value={value}
        aria-invalid={Boolean(error)}
        className={inputClassName}
        onChange={(event) => onChange(formatPhoneMask(event.target.value))}
      />
      <p className="font-mono text-xs tabular-nums text-muted-foreground">
        Stored as {e164 ?? "an E.164 number, e.g. +14125550123"}
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
