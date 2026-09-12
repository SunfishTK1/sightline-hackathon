import { insertMarketComp } from "@/lib/db/comps";
import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { estimateJobTravel } from "@/lib/market/campus-travel";
import { evaluateBrokerDecision } from "@/lib/market/evaluate-broker";
import { mapCategory } from "@/lib/market/map-category";
import { brokerEvaluateRequestSchema } from "@/lib/market/schemas";

export async function POST(request: Request) {
  return withDb(async () => {
    await ensureSchema();
    const body = await request.json();
    const parsed = brokerEvaluateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid evaluate request");
    }
    const result = await evaluateBrokerDecision(parsed.data);
    if (result.action === "ACCEPT" && result.agreedUsd && result.agreedUsd > 0) {
      const travel = estimateJobTravel({
        pickup: parsed.data.order.pickup_location,
        dropoff: parsed.data.order.dropoff_location,
        category: parsed.data.order.category,
        deadlineAt: parsed.data.order.deadline_at,
      });
      await insertMarketComp({
        category: mapCategory(parsed.data.order.category),
        pickup: parsed.data.order.pickup_location,
        dropoff: parsed.data.order.dropoff_location,
        distanceM: travel.distanceM,
        durationMin: travel.totalMin,
        paidUsd: result.agreedUsd,
        orderId: parsed.data.order.id ?? null,
        source: "broker",
      });
    }
    return result;
  });
}
