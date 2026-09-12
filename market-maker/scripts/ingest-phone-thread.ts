import { closePool } from "../src/lib/db/client";
import { findCandidateForTaskAndWorker, insertCandidates, updateCandidate } from "../src/lib/db/candidates";
import { appendTaskEvent } from "../src/lib/db/events";
import { insertMessage } from "../src/lib/db/messages";
import { ensureSchema } from "../src/lib/db/schema";
import { findTaskById, upsertTask } from "../src/lib/db/tasks";
import { newId } from "../src/lib/ids";
import { DEMO_TASK_ID } from "../src/lib/market/constants";
import type { Message, Task, TaskCandidate } from "../src/lib/market/types";
import { sendIMessage, enrollRecipient } from "../src/lib/messaging/imessage";
import { workerReplyConfirmation } from "../src/lib/messaging/resolve-thread";
import { taskRef } from "../src/lib/market/task-ref";
import { loadEnv } from "./load-env";

const USER = "user-dibda";
const PHONE = "+14808497383";

const TURNS: Array<{
  role: "user" | "assistant";
  content: string;
  taskId?: string;
  purpose: Message["purpose"];
}> = [
  {
    role: "user",
    content:
      "i have a task: help me find someone to carry a mini fridge of mine from morewood to donner. willing to pay $15 and needs to be completed in 50 mins",
    taskId: "task-fridge-dibda",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "assistant",
    content:
      "Submitted your request for someone to carry your mini fridge from Morewood to Donner for $15, to be completed within 50 minutes.",
    taskId: "task-fridge-dibda",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "assistant",
    content:
      "Your request is in: Move mini fridge from Morewood to Donner at $15.00. I'll text you when there's news.",
    taskId: "task-fridge-dibda",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "assistant",
    content:
      "Hey Divya - this is Gotchu, Thomas's hackathon build. You're in the worker pool, so I may text you task requests at any hour. Can you confirm you're ok being asked 24/7? Reply YES - it keeps the demo working. Reply STOP anytime to opt out.",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "user",
    content: "YES",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "assistant",
    content:
      "Got it, Divya—you’re available to receive job offers 24/7. Reply STOP anytime to opt out.",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "user",
    content: "COUNTER $15 25 min",
    taskId: DEMO_TASK_ID,
    purpose: "WORKER_COUNTER",
  },
  {
    role: "assistant",
    content:
      "Do you mean updating your mini fridge request to $15 with completion within 25 minutes, or countering a job offer?",
    taskId: "task-fridge-dibda",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "user",
    content: "countering the request made right above for the package pickup",
    taskId: DEMO_TASK_ID,
    purpose: "WORKER_COUNTER",
  },
  {
    role: "assistant",
    content:
      "I can’t submit a $15, 25-minute counteroffer in this beta, and I don’t see a package pickup offer in this chat.",
    purpose: "STATUS_UPDATE",
  },
  {
    role: "user",
    content: "COUNTER $15 25 min",
    taskId: DEMO_TASK_ID,
    purpose: "WORKER_COUNTER",
  },
  {
    role: "assistant",
    content:
      "Counteroffers aren’t supported yet, and I have no record of a package pickup offer for you. You can pass on an offer; only the requester can change its price.",
    purpose: "STATUS_UPDATE",
  },
];

async function main() {
  loadEnv();
  await ensureSchema();

  const now = new Date();
  const fridgeDeadline = new Date(now.getTime() + 50 * 60_000);
  const fridge: Task = {
    taskId: "task-fridge-dibda",
    requesterUuid: USER,
    rawText:
      "help me find someone to carry a mini fridge of mine from morewood to donner. willing to pay $15 and needs to be completed in 50 mins",
    structured: {
      title: "Morewood → Donner mini fridge move",
      description: "Carry a mini fridge from Morewood to Donner.",
      category: "MOVING",
      pickupLocation: "Morewood",
      dropoffLocation: "Donner",
      deadline: fridgeDeadline,
      estimatedMinutes: 50,
      requirements: ["Able to lift ~50 lbs"],
      categoryDetails: {
        kind: "MOVING",
        pickupLocation: "Morewood",
        dropoffLocation: "Donner",
        itemDescription: "Mini fridge",
        approximateWeightLbs: 50,
        stairsOrElevator: "UNKNOWN",
        helpersNeeded: 1,
      },
    },
    pricing: {
      initialOfferUsd: 15,
      maximumUsd: 25,
      agentMayIncreaseToUsd: 15,
      currentOfferUsd: 15,
      currency: "USD",
    },
    relaxationPlan: [],
    ethics: {
      allowed: true,
      risk: "LOW",
      reasons: ["Ordinary moving help"],
      reviewedAt: now,
    },
    taskEmbedding: [],
    status: "OPEN",
    createdAt: now,
    updatedAt: now,
  };
  await upsertTask(fridge);

  const packageTask = await findTaskById(DEMO_TASK_ID);
  if (!packageTask) throw new Error("Package task missing");

  let candidate = await findCandidateForTaskAndWorker(DEMO_TASK_ID, USER);
  if (!candidate) {
    const created: TaskCandidate = {
      candidateId: newId("cand"),
      taskId: DEMO_TASK_ID,
      workerUuid: USER,
      matchingRunId: "run_imessage_manual",
      rank: 1,
      scores: {
        vector: 0.5,
        priceFit: 1,
        availability: 0.85,
        reliability: 0.7,
        experience: 0.5,
        location: 1,
        final: 0.7,
      },
      reasons: ["Replied to live iMessage invitation"],
      invitation: {
        status: "RESPONDED",
        sentAt: now,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      },
      response: {},
      status: "CONTACTED",
      createdAt: now,
      updatedAt: now,
    };
    await insertCandidates([created]);
    candidate = created;
  }

  const base = Date.now() - TURNS.length * 1000;
  for (const [index, turn] of TURNS.entries()) {
    await insertMessage({
      messageId: newId("msg"),
      provider: "IMESSAGE",
      providerMessageId: `thread-${index}-${USER}`,
      userUuid: USER,
      taskId: turn.taskId,
      direction: turn.role === "user" ? "INBOUND" : "OUTBOUND",
      purpose: turn.purpose,
      body: turn.content,
      status: turn.role === "user" ? "RECEIVED" : "SENT",
      createdAt: new Date(base + index * 1000),
    });
  }

  const completion = new Date(Date.now() + 25 * 60_000);
  await updateCandidate(candidate.candidateId, {
    status: "INTERESTED",
    invitation: { ...candidate.invitation, status: "RESPONDED" },
    response: {
      decision: "COUNTER",
      priceUsd: 15,
      estimatedCompletionAt: completion,
      rawText: "COUNTER $15 25 min",
      receivedAt: new Date(),
    },
  });

  await appendTaskEvent({
    taskId: DEMO_TASK_ID,
    type: "WORKER_RESPONDED",
    actor: "USER",
    metadata: {
      workerUuid: USER,
      decision: "COUNTER",
      priceUsd: 15,
      minutes: 25,
      source: "ingested_imessage_thread",
    },
  });

  const confirm = workerReplyConfirmation(packageTask, {
    decision: "COUNTER",
    priceUsd: 15,
    minutes: 25,
  });

  await enrollRecipient(PHONE);
  const sent = await sendIMessage({
    to: PHONE,
    text: confirm,
    dryRun: false,
    idempotencyKey: `confirm-gates-counter-${USER}`,
  });

  await insertMessage({
    messageId: newId("msg"),
    provider: "IMESSAGE",
    providerMessageId: sent.providerMessageId ?? sent.requestId,
    userUuid: USER,
    taskId: DEMO_TASK_ID,
    direction: "OUTBOUND",
    purpose: "STATUS_UPDATE",
    body: confirm,
    status: sent.dryRun ? "QUEUED" : "SENT",
    createdAt: new Date(),
  });

  console.log(
    JSON.stringify(
      {
        fridgeTask: fridge.taskId,
        packageTask: DEMO_TASK_ID,
        packageRef: taskRef(packageTask),
        counterRecorded: { priceUsd: 15, minutes: 25 },
        confirmation: confirm,
        send: { dryRun: sent.dryRun, status: sent.status },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
