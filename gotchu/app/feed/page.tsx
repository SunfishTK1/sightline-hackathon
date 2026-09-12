/** @owner Daphne — open task pool */
import { FeedList } from "@/components/feed/FeedList";

export default function FeedPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-semibold">Open tasks</h1>
      <p className="mb-8 text-muted-foreground">What&apos;s available on campus right now.</p>
      <FeedList />
    </main>
  );
}
