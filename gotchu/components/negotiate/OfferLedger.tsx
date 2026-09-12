/** @owner Daphne */
import type { NegotiationMessage } from "@/lib/types/offer";

export function OfferLedger({ messages }: { messages: NegotiationMessage[] }) {
  return (
    <div className="flex flex-wrap gap-3 font-mono text-sm tabular-nums">
      {messages.map((m, i) => (
        <span key={`${m.round}-${m.from}-${i}`} className="opacity-80">
          r{m.round} {m.from === "worker_agent" ? "W" : "R"} ${m.priceUsd}
        </span>
      ))}
    </div>
  );
}
