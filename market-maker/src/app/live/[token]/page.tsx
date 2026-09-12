import { notFound } from "next/navigation";
import { ensureSchema } from "@/lib/db/schema";
import { loadLiveBoard } from "@/lib/db/live";
import { LiveBoard } from "./live-board";

export const dynamic = "force-dynamic";

export default async function LivePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await ensureSchema();
  const { token } = await params;
  const board = await loadLiveBoard(token);
  if (!board) notFound();

  return <LiveBoard token={token} initial={board} />;
}
