import type {
  EvaluateNegotiation,
  FinalizeAgreement,
  RequestRequesterApproval,
} from "./contracts";
import { notImplemented } from "./not-implemented";

export const evaluateNegotiation: EvaluateNegotiation = async (
  _negotiationId,
) => {
  notImplemented("evaluateNegotiation");
};

export const requestRequesterApproval: RequestRequesterApproval = async (
  _taskId,
) => {
  notImplemented("requestRequesterApproval");
};

export const finalizeAgreement: FinalizeAgreement = async (_negotiationId) => {
  notImplemented("finalizeAgreement");
};
