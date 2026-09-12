/** @owner Divya — candidate ranking view */
import { CandidateList } from "@/components/match/CandidateList";

type Props = { params: Promise<{ taskId: string }> };

export default async function MatchesPage({ params }: Props) {
  const { taskId } = await params;
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-semibold">Matches</h1>
      <p className="mb-8 text-muted-foreground">
        Ranked by preference similarity, rating, and experience.
      </p>
      <CandidateList taskId={taskId} />
    </main>
  );
}
