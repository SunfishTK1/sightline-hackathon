import { withDb, HttpError } from "@/lib/api/with-db";
import { ensureSchema } from "@/lib/db/schema";
import { quoteBrokerOrder } from "@/lib/market/broker-quote";
import { brokerQuoteRequestSchema } from "@/lib/market/schemas";

export async function POST(request: Request) {
  return withDb(async () => {
    await ensureSchema();
    const body = await request.json();
    const parsed = brokerQuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid quote request");
    }
    return quoteBrokerOrder(parsed.data);
  });
}
