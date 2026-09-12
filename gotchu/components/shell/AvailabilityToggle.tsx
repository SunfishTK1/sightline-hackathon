/** @owner Will — availability switch in header */
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

export function AvailabilityToggle() {
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/api/me");
      const json = (await res.json()) as {
        ok: boolean;
        data?: { user?: { availability?: { isAvailable?: boolean } } | null };
      };
      if (cancelled) return;
      if (json.ok && json.data?.user) {
        setChecked(Boolean(json.data.user.availability?.isAvailable));
        setReady(true);
      }
    }

    void load();
    window.addEventListener("gotchu:user-updated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("gotchu:user-updated", load);
    };
  }, []);

  if (!ready) {
    return (
      <span className="text-sm text-muted-foreground">Available after setup</span>
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-[var(--broker)]"
        checked={checked}
        disabled={pending}
        onChange={async (event) => {
          const next = event.target.checked;
          setChecked(next);
          setPending(true);
          try {
            const res = await fetch("/api/me/availability", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isAvailable: next }),
            });
            const json = (await res.json()) as { ok: boolean; error?: string };
            if (!json.ok) {
              setChecked(!next);
              toast.error(json.error ?? "Could not update availability");
              return;
            }
            toast.success(next ? "You're available" : "You're off the market");
          } catch {
            setChecked(!next);
            toast.error("Could not update availability");
          } finally {
            setPending(false);
          }
        }}
      />
      Available
    </label>
  );
}
