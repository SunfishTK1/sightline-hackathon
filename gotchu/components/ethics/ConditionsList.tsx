/** @owner Will */
export function ConditionsList({ conditions }: { conditions: string[] }) {
  if (!conditions.length) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {conditions.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}
