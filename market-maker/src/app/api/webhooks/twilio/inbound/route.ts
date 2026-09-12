import { notReady } from "@/lib/api/not-ready";

export async function POST() {
  return notReady("handleInboundMessage", "daphne");
}
