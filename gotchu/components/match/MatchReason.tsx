/** @owner Divya */
export function MatchReason({ reasons }: { reasons: string[] }) {
  return (
    <p className="text-sm text-muted-foreground">
      {reasons.join(" · ") || "No reason yet"}
    </p>
  );
}
