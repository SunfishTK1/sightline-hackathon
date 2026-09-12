/** @owner Will */
import { Badge } from "@/components/ui/badge";
import type { EthicsVerdictLabel } from "@/lib/types/ethics";

const styles: Record<EthicsVerdictLabel, string> = {
  ALLOW: "bg-[var(--broker)]/15 text-[var(--broker)]",
  ALLOW_WITH_CONDITIONS: "bg-[var(--hold)]/25 text-[var(--ink)]",
  BLOCK: "bg-[var(--stop)]/15 text-[var(--stop)]",
};

export function EthicsBadge({ verdict }: { verdict: EthicsVerdictLabel }) {
  return (
    <Badge variant="secondary" className={styles[verdict]}>
      {verdict.replaceAll("_", " ")}
    </Badge>
  );
}
