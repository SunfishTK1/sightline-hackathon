/** @owner Divya */
export function ScoreBars({
  vector,
  rating,
  experience,
}: {
  vector: number;
  rating: number;
  experience: number;
}) {
  const rows = [
    { label: "vector", value: vector },
    { label: "rating", value: rating },
    { label: "experience", value: experience },
  ];
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-20 text-muted-foreground">{r.label}</span>
          <div className="h-2 flex-1 bg-muted">
            <div
              className="h-full bg-[var(--broker)]"
              style={{ width: `${Math.round(r.value * 100)}%` }}
            />
          </div>
          <span className="w-10 font-mono tabular-nums">{r.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
