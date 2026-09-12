import { closePool } from "../src/lib/db/client";
import { appendTaskEvent } from "../src/lib/db/events";
import { insertMessage } from "../src/lib/db/messages";
import { ensureSchema } from "../src/lib/db/schema";
import { findTaskById, updateTaskFields } from "../src/lib/db/tasks";
import { newId } from "../src/lib/ids";
import { loadEnv } from "./load-env";

const USER = "user-dibda";
const FRIDGE = "task-fridge-dibda";

async function main() {
  loadEnv();
  await ensureSchema();

  const task = await findTaskById(FRIDGE);
  if (!task) {
    throw new Error("Fridge task not found. Run the previous ingest first.");
  }

  const at = new Date("2026-09-12T02:34:51.640Z");
  const body =
    'Someone will do "Move mini fridge from Morewood to Donner" for $25 instead of $15. They said: "it\'s a fridge, needs two hands and a lift" Reply YES to agree or NO to pass.';

  await insertMessage({
    messageId: newId("msg"),
    provider: "IMESSAGE",
    providerMessageId: "thread-fridge-offer-25",
    userUuid: USER,
    taskId: FRIDGE,
    direction: "OUTBOUND",
    purpose: "REQUESTER_RELAXATION",
    body,
    status: "SENT",
    createdAt: new Date(),
  });

  await updateTaskFields(FRIDGE, {
    status: "WAITING_FOR_REQUESTER",
    pricing: {
      ...task.pricing,
      currentOfferUsd: 25,
    },
  });

  await appendTaskEvent({
    taskId: FRIDGE,
    type: "WORKER_COUNTER_PRESENTED_TO_REQUESTER",
    actor: "PERSONAL_AGENT",
    metadata: {
      previousPriceUsd: 15,
      proposedPriceUsd: 25,
      workerNote: "it's a fridge, needs two hands and a lift",
      presentedAt: at.toISOString(),
    },
  });

  console.log(
    JSON.stringify(
      {
        taskId: FRIDGE,
        status: "WAITING_FOR_REQUESTER",
        pending: { fromUsd: 15, toUsd: 25 },
        routing:
          "Latest outbound is this fridge YES/NO. A YES/NO reply binds to the fridge, not Gates.",
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
