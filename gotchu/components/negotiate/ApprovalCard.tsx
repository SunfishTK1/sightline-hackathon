/** @owner Daphne */
"use client";

import { Button } from "@/components/ui/button";

export function ApprovalCard({ taskId }: { taskId: string }) {
  void taskId;
  return (
    <div className="space-y-4 border border-[var(--hold)] bg-[var(--hold)]/10 p-4">
      <p className="text-sm text-muted-foreground">Pending approval</p>
      <p className="text-3xl font-semibold tabular-nums">$11</p>
      <p className="text-sm">Both sides must approve before the deal is locked.</p>
      <div className="flex gap-3">
        <Button type="button">Approve $11 deal</Button>
        <Button type="button" variant="outline">
          Decline
        </Button>
      </div>
    </div>
  );
}
