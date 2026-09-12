import { closePool } from "../src/lib/db/client";
import { insertMessage } from "../src/lib/db/messages";
import { ensureSchema } from "../src/lib/db/schema";
import { findTaskById } from "../src/lib/db/tasks";
import { upsertUser } from "../src/lib/db/users";
import { newId } from "../src/lib/ids";
import { DEMO_TASK_ID } from "../src/lib/market/constants";
import { enrollRecipient, sendIMessage } from "../src/lib/messaging/imessage";
import { workerInvitationText } from "../src/lib/messaging/templates";
import { normalizePhone } from "../src/lib/phone";
import { loadEnv } from "./load-env";

const PHONE = normalizePhone("+1 480-849-7383");

async function main() {
  loadEnv();
  await ensureSchema();

  const now = new Date();
  await upsertUser({
    uuid: "user-dibda",
    auth0Sub: "auth0|dibda",
    firstName: "Dibda",
    lastName: "Student",
    cmuEmail: "dibda@andrew.cmu.edu",
    phone: PHONE,
    preferenceText:
      "Can do package pickups and campus errands around Gates and the UC.",
    preferenceEmbedding: [],
    workerProfile: {
      enabled: true,
      categories: ["PACKAGE_PICKUP", "CAMPUS_ERRAND", "FOOD_RUN"],
      excludedCategories: [],
      typicalLocations: ["UC", "Gates"],
      minPriceUsd: 8,
      preferredPriceUsd: 10,
      maxTravelMinutes: 20,
      allowAgentAutoReject: true,
      allowAgentAutoAccept: false,
    },
    requesterProfile: {
      defaultMaxPriceUsd: 20,
      allowAutomaticCounters: false,
      maxAutomaticPriceIncreaseUsd: 0,
      maxAutomaticDeadlineExtensionMinutes: 0,
    },
    stats: {
      tasksRequested: 0,
      tasksCompletedAsWorker: 0,
      requesterAvgRating: null,
      workerAvgRating: null,
      ratingCount: 0,
      acceptanceRate: null,
      completionRate: null,
    },
    availability: { isAvailable: true },
    createdAt: now,
    updatedAt: now,
  });

  const task = await findTaskById(DEMO_TASK_ID);
  if (!task) {
    throw new Error("Demo task not found. Run npm run seed first.");
  }

  const body = workerInvitationText(task, "5 min");
  await enrollRecipient(PHONE);

  const messageId = newId("msg");
  const result = await sendIMessage({
    to: PHONE,
    text: body,
    service: "auto",
    dryRun: false,
    idempotencyKey: messageId,
  });

  await insertMessage({
    messageId,
    provider: "IMESSAGE",
    providerMessageId: result.providerMessageId ?? result.requestId,
    userUuid: "user-dibda",
    taskId: task.taskId,
    direction: "OUTBOUND",
    purpose: "WORKER_INVITATION",
    body,
    status: result.dryRun ? "QUEUED" : "SENT",
    createdAt: new Date(),
  });

  console.log(
    JSON.stringify(
      {
        to: PHONE,
        dryRun: result.dryRun,
        status: result.status,
        requestId: result.requestId,
        body,
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
