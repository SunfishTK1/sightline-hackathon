import { notReady } from "@/lib/api/not-ready";
import { relaxTaskBodySchema } from "@/lib/market/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  await params;
  relaxTaskBodySchema.parse(await request.json());
  return notReady("buildRelaxationOptions", "matching");
}
