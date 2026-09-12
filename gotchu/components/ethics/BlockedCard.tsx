/** @owner Will */
import { Button } from "@/components/ui/button";

export function BlockedCard({
  reason,
  onRevise,
}: {
  reason: string;
  onRevise?: () => void;
}) {
  return (
    <div className="space-y-3 border border-[var(--stop)]/30 bg-[var(--stop)]/5 p-4">
      <p className="font-medium text-[var(--stop)]">This request was blocked</p>
      <p className="text-sm text-muted-foreground">{reason}</p>
      {onRevise ? (
        <Button type="button" variant="outline" onClick={onRevise}>
          Revise request
        </Button>
      ) : null}
    </div>
  );
}
