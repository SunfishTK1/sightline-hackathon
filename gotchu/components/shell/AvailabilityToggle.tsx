/** @owner Will — availability switch in header */
"use client";

export function AvailabilityToggle() {
  // TODO(Will): PATCH /api/me/availability
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" className="size-4 accent-[var(--broker)]" defaultChecked />
      Available
    </label>
  );
}
