type IconKind = "table" | "board" | "food" | "box" | "bag" | "brush" | "dot";

export function iconKindFor(title: string, category?: string | null): IconKind {
  const blob = `${category ?? ""} ${title}`.toLowerCase();
  if (/\b(tutor|whiteboard|homework|lesson|study)\b/.test(blob)) return "board";
  if (/\b(food|lunch|coffee|tepper|eat|entree)\b/.test(blob)) return "food";
  if (/\b(paint|fence|brush)\b/.test(blob)) return "brush";
  if (/\b(table|desk|fridge|furniture|move|moving)\b/.test(blob)) return "table";
  if (/\b(package|pickup|parcel|box)\b/.test(blob)) return "box";
  if (/\b(errand|bag)\b/.test(blob)) return "bag";
  return "dot";
}

export function TaskIcon({
  kind,
  color,
  size = 44,
}: {
  kind: IconKind;
  color: string;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "table") {
    return (
      <svg {...common} aria-hidden>
        <path d="M4 9h16M6 9v10M18 9v10M8 13h8" />
      </svg>
    );
  }
  if (kind === "board") {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="4" width="18" height="13" rx="1.5" />
        <path d="M8 21h8M12 17v4M7 8h6M7 11h10" />
      </svg>
    );
  }
  if (kind === "food") {
    return (
      <svg {...common} aria-hidden>
        <path d="M4 11h16l-1.2 8H5.2L4 11z" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    );
  }
  if (kind === "box") {
    return (
      <svg {...common} aria-hidden>
        <path d="M3 8l9-4 9 4-9 4-9-4z" />
        <path d="M3 8v8l9 4 9-4V8M12 12v8" />
      </svg>
    );
  }
  if (kind === "bag") {
    return (
      <svg {...common} aria-hidden>
        <path d="M6 8h12l1 13H5L6 8z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
    );
  }
  if (kind === "brush") {
    return (
      <svg {...common} aria-hidden>
        <path d="M14 4l6 6-8 8H6v-6l8-8z" />
        <path d="M6 16v4h4" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}
