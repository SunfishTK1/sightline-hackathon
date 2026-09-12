/**
 * Placeholder for the teammate ethics / arbitration agent.
 * Every broker quote and evaluate goes through here before we return a price.
 */
export interface BrokerEthicsVerdict {
  allowed: boolean;
  verdict: "ALLOW" | "BLOCK";
  reasons: string[];
}

export function reviewBrokerAction(_input?: {
  title?: string;
  details?: string;
  note?: string;
}): BrokerEthicsVerdict {
  void _input;
  return { allowed: true, verdict: "ALLOW", reasons: [] };
}
