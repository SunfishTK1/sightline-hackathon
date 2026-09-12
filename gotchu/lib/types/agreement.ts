/** @owner Daphne */
export interface AgreementPayment {
  method: "cash" | "solana";
  solanaTxSig: string | null;
  status: "unpaid" | "pending" | "paid";
}

export interface Agreement {
  taskId: string;
  requesterUuid: string;
  workerUuid: string;
  finalPriceUsd: number;
  terms: string[];
  requesterApprovedAt?: string;
  workerApprovedAt?: string;
  payment: AgreementPayment;
  createdAt: string;
}
