import { withDb, HttpError } from "@/lib/api/with-db";
import { evaluateBrokerDecision } from "@/lib/market/evaluate-broker";
import { brokerEvaluateRequestSchema } from "@/lib/market/schemas";

export async function POST(request: Request) {
  return withDb(async () => {
    const body = await request.json();
    const parsed = brokerEvaluateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid evaluate request");
    }
    return evaluateBrokerDecision(parsed.data);
  });
}
