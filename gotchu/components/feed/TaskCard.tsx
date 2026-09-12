/** @owner Daphne */
import { EthicsBadge } from "@/components/ethics/EthicsBadge";

export function TaskCard() {
  return (
    <li className="space-y-2 border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">Sample open task</p>
        <EthicsBadge verdict="ALLOW" />
      </div>
      <p className="text-sm text-muted-foreground">pickup · before 6pm</p>
      <p className="font-mono text-xl tabular-nums">$10</p>
    </li>
  );
}
