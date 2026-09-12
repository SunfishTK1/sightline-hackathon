import { taskRef } from "@/lib/market/task-ref";
import type { RelaxationOption, Task } from "@/lib/market/types";

export function workerInvitationText(
  task: Task,
  expiresInLabel: string,
): string {
  const pickup = task.structured.pickupLocation ?? "pickup";
  const dropoff = task.structured.dropoffLocation ?? "dropoff";
  const ref = taskRef(task);
  return [
    `Gotchu [${ref}]: ${task.structured.title} from ${pickup} to ${dropoff} by ${formatTime(task.structured.deadline)}.`,
    `Estimated ${task.structured.estimatedMinutes} min, offering $${task.pricing.currentOfferUsd}.`,
    `Reply YES, NO, or COUNTER for this [${ref}] job only. Expires in ${expiresInLabel}.`,
  ].join(" ");
}

export function requesterRelaxationText(
  task: Task,
  options: RelaxationOption[],
): string {
  const lines = [
    `No one is available for $${task.pricing.currentOfferUsd} by ${formatTime(task.structured.deadline)}.`,
  ];
  options.forEach((option, index) => {
    lines.push(
      `${index + 1}) $${option.proposedPriceUsd} by ${formatTime(option.deadline)} (${option.label})`,
    );
  });
  lines.push("Reply 1, 2, or NO.");
  return lines.join(" ");
}

export function finalApprovalText(input: {
  workerFirstName: string;
  title: string;
  deadline: Date;
  priceUsd: number;
}): string {
  return [
    `${input.workerFirstName} can complete the ${input.title} by ${formatTime(input.deadline)} for $${input.priceUsd}.`,
    "Reply APPROVE to confirm. No agreement is created until both sides approve.",
  ].join(" ");
}

export function clarificationText(): string {
  return "Gotchu: I didn't catch that. Reply YES, NO, or COUNTER $amount, time.";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
