/** @owner Thomas — the "type what you need" screen */
import { ComposeBox } from "@/components/task/ComposeBox";

export default function ComposePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-semibold">Need something?</h1>
      <p className="mb-8 text-muted-foreground">
        Type it in plain English. Your agent will structure it.
      </p>
      <ComposeBox />
    </main>
  );
}
