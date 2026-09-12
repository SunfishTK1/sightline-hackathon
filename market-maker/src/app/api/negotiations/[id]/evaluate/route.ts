import { notReady } from "@/lib/api/not-ready";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  return notReady("evaluateNegotiation", "daphne");
}
