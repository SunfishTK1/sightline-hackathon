/** @owner Daphne — negotiation replay + approval */
import { TranscriptView } from "@/components/negotiate/TranscriptView";
import { ApprovalCard } from "@/components/negotiate/ApprovalCard";

type Props = { params: Promise<{ taskId: string }> };

export default async function TaskPage({ params }: Props) {
  const { taskId } = await params;
  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-6 py-12">
      <h1 className="text-3xl font-semibold">Task {taskId}</h1>
      <TranscriptView taskId={taskId} />
      <ApprovalCard taskId={taskId} />
    </main>
  );
}
