/** @owner Daphne — outdoor campus map of open tasks */
import Link from "next/link";
import { CampusMap } from "@/components/map/CampusMap";

export default function MapPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <p className="mb-2 text-sm">
        <Link href="/feed" className="text-muted-foreground underline-offset-4 hover:underline">
          Open tasks
        </Link>
      </p>
      <h1 className="mb-2 text-3xl font-semibold">Campus map</h1>
      <p className="mb-8 text-muted-foreground">
        Open jobs pinned to CMU buildings. Outdoor only — no indoor maps.
      </p>
      <CampusMap />
    </main>
  );
}
