import { notReady } from "@/lib/api/not-ready";
import { approveNegotiationBodySchema } from "@/lib/market/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  approveNegotiationBodySchema.parse(await request.json());
  return notReady("finalizeAgreement", "daphne");
}
