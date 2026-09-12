import { notReady } from "@/lib/api/not-ready";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  await params;
  return notReady("createMatchingRun", "matching");
}
