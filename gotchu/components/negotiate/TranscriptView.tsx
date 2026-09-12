/** @owner Daphne */
import { MOCK_NEGOTIATION_OFFER } from "@/mocks/negotiation";
import { OfferLedger } from "./OfferLedger";

export function TranscriptView({ taskId }: { taskId: string }) {
  void taskId;
  const offer = MOCK_NEGOTIATION_OFFER;
  return (
    <div className="space-y-4 bg-[var(--ink)] p-4 text-[var(--page)]">
      <p className="text-sm opacity-70">Negotiation replay</p>
      <OfferLedger messages={offer.transcript} />
      <ul className="space-y-3">
        {offer.transcript.map((m, i) => (
          <li
            key={`${m.round}-${m.from}-${i}`}
            className={m.from === "worker_agent" ? "text-left" : "text-right"}
          >
            <p className="text-xs opacity-60">
              {m.from} · round {m.round}
            </p>
            <p>{m.rationale}</p>
            <p className="font-mono text-lg tabular-nums">${m.priceUsd}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
