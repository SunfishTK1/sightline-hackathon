import { closePool } from "../src/lib/db/client";
import { ensureSchema } from "../src/lib/db/schema";
import { upsertTask } from "../src/lib/db/tasks";
import { upsertUser } from "../src/lib/db/users";
import { loadEnv } from "./load-env";
import { DEMO_REQUESTER_UUID, DEMO_TASK_ID } from "../src/lib/market/constants";
import type {
  Task,
  TaskCategory,
  User,
  UserStats,
  WorkerProfile,
} from "../src/lib/market/types";

function tomorrowAt(hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function emptyStats(overrides: Partial<UserStats> = {}): UserStats {
  return {
    tasksRequested: 0,
    tasksCompletedAsWorker: 0,
    requesterAvgRating: null,
    workerAvgRating: null,
    ratingCount: 0,
    acceptanceRate: null,
    completionRate: null,
    ...overrides,
  };
}

function worker(input: {
  categories: TaskCategory[];
  excludedCategories?: TaskCategory[];
  typicalLocations: string[];
  availabilityText?: string;
  minPriceUsd?: number;
  preferredPriceUsd?: number;
  enabled?: boolean;
  allowAgentAutoAccept?: boolean;
  autoAcceptRules?: WorkerProfile["autoAcceptRules"];
}): WorkerProfile {
  return {
    enabled: input.enabled ?? true,
    categories: input.categories,
    excludedCategories: input.excludedCategories ?? [],
    typicalLocations: input.typicalLocations,
    availabilityText: input.availabilityText,
    minPriceUsd: input.minPriceUsd,
    preferredPriceUsd: input.preferredPriceUsd,
    maxTravelMinutes: 20,
    allowAgentAutoReject: true,
    allowAgentAutoAccept: input.allowAgentAutoAccept ?? false,
    autoAcceptRules: input.autoAcceptRules,
  };
}

function user(input: Omit<User, "createdAt" | "updatedAt" | "preferenceEmbedding" | "requesterProfile"> & {
  requesterProfile?: User["requesterProfile"];
}): User {
  const now = new Date();
  return {
    ...input,
    preferenceEmbedding: [],
    requesterProfile: input.requesterProfile ?? {
      defaultMaxPriceUsd: 20,
      allowAutomaticCounters: false,
      maxAutomaticPriceIncreaseUsd: 0,
      maxAutomaticDeadlineExtensionMinutes: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function buildUsers(): User[] {
  return [
    user({
      uuid: DEMO_REQUESTER_UUID,
      auth0Sub: "auth0|divya",
      firstName: "Divya",
      lastName: "Rao",
      cmuEmail: "divya@andrew.cmu.edu",
      phone: "+14125551001",
      preferenceText:
        "Usually needs campus deliveries and food runs. Rarely works tasks.",
      workerProfile: worker({
        enabled: false,
        categories: [],
        typicalLocations: ["Gates", "UC"],
      }),
      requesterProfile: {
        defaultMaxPriceUsd: 16,
        allowAutomaticCounters: false,
        maxAutomaticPriceIncreaseUsd: 0,
        maxAutomaticDeadlineExtensionMinutes: 0,
      },
      stats: emptyStats({ tasksRequested: 4 }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-daphne",
      auth0Sub: "auth0|daphne",
      firstName: "Daphne",
      lastName: "Chen",
      cmuEmail: "daphne@andrew.cmu.edu",
      phone: "+14125551002",
      preferenceText:
        "Happy to do food runs around campus, especially from the UC or Tepper. Usually accepts around $8-$12.",
      workerProfile: worker({
        categories: ["FOOD_RUN", "CAMPUS_ERRAND"],
        typicalLocations: ["UC", "Tepper", "Wean"],
        availabilityText: "Afternoons and evenings",
        minPriceUsd: 7,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 6,
        workerAvgRating: 4.8,
        ratingCount: 6,
        acceptanceRate: 0.7,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-alex",
      auth0Sub: "auth0|alex",
      firstName: "Alex",
      lastName: "Kim",
      cmuEmail: "alexk@andrew.cmu.edu",
      phone: "+14125551003",
      preferenceText:
        "I grab food for friends a lot. Cheap food runs from Tepper, Cohon, or the Cut.",
      workerProfile: worker({
        categories: ["FOOD_RUN"],
        typicalLocations: ["Tepper", "Cohon", "The Cut"],
        minPriceUsd: 6,
        preferredPriceUsd: 8,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 11,
        workerAvgRating: 4.6,
        ratingCount: 10,
        acceptanceRate: 0.8,
        completionRate: 0.95,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-jordan",
      auth0Sub: "auth0|jordan",
      firstName: "Jordan",
      lastName: "Patel",
      cmuEmail: "jpatel@andrew.cmu.edu",
      phone: "+14125551004",
      preferenceText:
        "Food deliveries only if the pay is decent. Not interested in cheap snack runs.",
      workerProfile: worker({
        categories: ["FOOD_RUN"],
        typicalLocations: ["UC", "Gates"],
        minPriceUsd: 12,
        preferredPriceUsd: 15,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 3,
        workerAvgRating: 4.2,
        ratingCount: 3,
        acceptanceRate: 0.4,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-sam",
      auth0Sub: "auth0|sam",
      firstName: "Sam",
      lastName: "Okoro",
      cmuEmail: "sokoro@andrew.cmu.edu",
      phone: "+14125551005",
      preferenceText:
        "Package pickups from the UC mailroom to Gates, Wean, or Hunt. Used to campus shipping.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP", "CAMPUS_ERRAND"],
        typicalLocations: ["UC", "Gates", "Wean", "Hunt"],
        availabilityText: "Between classes until 7 PM",
        minPriceUsd: 8,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 9,
        workerAvgRating: 4.9,
        ratingCount: 8,
        acceptanceRate: 0.75,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-riley",
      auth0Sub: "auth0|riley",
      firstName: "Riley",
      lastName: "Nguyen",
      cmuEmail: "rnguyen@andrew.cmu.edu",
      phone: "+14125551006",
      preferenceText:
        "Campus errands, food runs, and package pickups. I walk between the UC and Gates all day.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP", "FOOD_RUN", "CAMPUS_ERRAND"],
        typicalLocations: ["UC", "Gates", "Baker"],
        minPriceUsd: 8,
        preferredPriceUsd: 11,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 5,
        workerAvgRating: 4.5,
        ratingCount: 5,
        acceptanceRate: 0.6,
        completionRate: 0.9,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-casey",
      auth0Sub: "auth0|casey",
      firstName: "Casey",
      lastName: "Brooks",
      cmuEmail: "cbrooks@andrew.cmu.edu",
      phone: "+14125551007",
      preferenceText:
        "I tutor discrete math and 15-122. I do not do deliveries or pickups.",
      workerProfile: worker({
        categories: ["TUTORING"],
        typicalLocations: ["Gates", "Wean"],
        minPriceUsd: 25,
        preferredPriceUsd: 30,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 14,
        workerAvgRating: 5,
        ratingCount: 12,
        acceptanceRate: 0.5,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-morgan",
      auth0Sub: "auth0|morgan",
      firstName: "Morgan",
      lastName: "Lee",
      cmuEmail: "mlee2@andrew.cmu.edu",
      phone: "+14125551008",
      preferenceText:
        "Heavy lifting and moving mini fridges, furniture, and bins around Morewood and Donner.",
      workerProfile: worker({
        categories: ["MOVING"],
        typicalLocations: ["Morewood", "Donner", "Resnik", "Mudge"],
        minPriceUsd: 20,
        preferredPriceUsd: 30,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 4,
        workerAvgRating: 4.7,
        ratingCount: 4,
        acceptanceRate: 0.65,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-quinn",
      auth0Sub: "auth0|quinn",
      firstName: "Quinn",
      lastName: "Shah",
      cmuEmail: "qshah@andrew.cmu.edu",
      phone: "+14125551009",
      preferenceText: "Usually does package pickups, but is busy this week.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP", "FOOD_RUN"],
        typicalLocations: ["UC", "Gates"],
        minPriceUsd: 8,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 2,
        workerAvgRating: 4,
        ratingCount: 2,
      }),
      availability: { isAvailable: false, until: tomorrowAt(22) },
    }),
    user({
      uuid: "user-avery",
      auth0Sub: "auth0|avery",
      firstName: "Avery",
      lastName: "Santos",
      cmuEmail: "asantos@andrew.cmu.edu",
      phone: "+14125551010",
      preferenceText:
        "Campus errands and package pickups. I opted out of food runs.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP", "CAMPUS_ERRAND"],
        excludedCategories: ["FOOD_RUN"],
        typicalLocations: ["UC", "Hunt"],
        minPriceUsd: 9,
        preferredPriceUsd: 12,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 7,
        workerAvgRating: 4.4,
        ratingCount: 7,
        acceptanceRate: 0.55,
        completionRate: 0.85,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-cameron",
      auth0Sub: "auth0|cameron",
      firstName: "Cameron",
      lastName: "Wright",
      cmuEmail: "cwright@andrew.cmu.edu",
      phone: "+14125551011",
      preferenceText:
        "Package pickups from the UC. My agent may auto-accept short UC-to-Gates jobs at $10+.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP"],
        typicalLocations: ["UC", "Gates"],
        minPriceUsd: 8,
        preferredPriceUsd: 10,
        allowAgentAutoAccept: true,
        autoAcceptRules: {
          minPriceUsd: 10,
          maxEstimatedMinutes: 30,
          categories: ["PACKAGE_PICKUP"],
        },
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 8,
        workerAvgRating: 4.6,
        ratingCount: 8,
        acceptanceRate: 0.85,
        completionRate: 0.97,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-blake",
      auth0Sub: "auth0|blake",
      firstName: "Blake",
      lastName: "Iyer",
      cmuEmail: "biyer@andrew.cmu.edu",
      phone: "+14125551012",
      preferenceText: "General campus errands: printing, lockouts, quick walks.",
      workerProfile: worker({
        categories: ["CAMPUS_ERRAND"],
        typicalLocations: ["UC", "CFA", "Hunt"],
        minPriceUsd: 7,
        preferredPriceUsd: 9,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 3,
        workerAvgRating: 4.1,
        ratingCount: 3,
        acceptanceRate: 0.5,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-drew",
      auth0Sub: "auth0|drew",
      firstName: "Drew",
      lastName: "Haddad",
      cmuEmail: "dhaddad@andrew.cmu.edu",
      phone: "+14125551013",
      preferenceText:
        "I live near Gates and pick up packages from the UC on my way back.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP"],
        typicalLocations: ["Gates", "UC"],
        availabilityText: "After 4 PM",
        minPriceUsd: 8,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 6,
        workerAvgRating: 4.8,
        ratingCount: 6,
        acceptanceRate: 0.7,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-emerson",
      auth0Sub: "auth0|emerson",
      firstName: "Emerson",
      lastName: "Cole",
      cmuEmail: "ecole@andrew.cmu.edu",
      phone: "+14125551014",
      preferenceText: "Usually around the UC. Fine with food or small pickups.",
      workerProfile: worker({
        categories: ["FOOD_RUN", "PACKAGE_PICKUP"],
        typicalLocations: ["UC"],
        minPriceUsd: 7,
        preferredPriceUsd: 9,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 2,
        ratingCount: 1,
        workerAvgRating: 5,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-finley",
      auth0Sub: "auth0|finley",
      firstName: "Finley",
      lastName: "Park",
      cmuEmail: "fpark@andrew.cmu.edu",
      phone: "+14125551015",
      preferenceText:
        "Reliable food and package runner. High completion rate, campus-wide.",
      workerProfile: worker({
        categories: ["FOOD_RUN", "PACKAGE_PICKUP", "CAMPUS_ERRAND"],
        typicalLocations: ["UC", "Gates", "Wean", "Tepper"],
        minPriceUsd: 9,
        preferredPriceUsd: 12,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 22,
        workerAvgRating: 4.9,
        ratingCount: 20,
        acceptanceRate: 0.72,
        completionRate: 0.98,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-harper",
      auth0Sub: "auth0|harper",
      firstName: "Harper",
      lastName: "Singh",
      cmuEmail: "hsingh@andrew.cmu.edu",
      phone: "+14125551016",
      preferenceText: "New to this. Interested in food runs and easy pickups.",
      workerProfile: worker({
        categories: ["FOOD_RUN", "PACKAGE_PICKUP"],
        typicalLocations: ["UC", "Morewood"],
        minPriceUsd: 8,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats(),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-indigo",
      auth0Sub: "auth0|indigo",
      firstName: "Indigo",
      lastName: "Marsh",
      cmuEmail: "imarsh@andrew.cmu.edu",
      phone: "+14125551017",
      preferenceText:
        "I will do almost any campus task if the price is high enough.",
      workerProfile: worker({
        categories: ["FOOD_RUN", "PACKAGE_PICKUP", "MOVING", "CAMPUS_ERRAND"],
        typicalLocations: ["Campus"],
        minPriceUsd: 18,
        preferredPriceUsd: 25,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 1,
        workerAvgRating: 4,
        ratingCount: 1,
        acceptanceRate: 0.2,
        completionRate: 1,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-jules",
      auth0Sub: "auth0|jules",
      firstName: "Jules",
      lastName: "Ortega",
      cmuEmail: "jortega@andrew.cmu.edu",
      phone: "+14125551018",
      preferenceText:
        "Night owl. Better for later deadlines, food or packages after 7 PM.",
      workerProfile: worker({
        categories: ["FOOD_RUN", "PACKAGE_PICKUP"],
        typicalLocations: ["UC", "Gates"],
        availabilityText: "After 7 PM",
        minPriceUsd: 8,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 5,
        workerAvgRating: 4.3,
        ratingCount: 5,
        acceptanceRate: 0.6,
        completionRate: 0.8,
      }),
      availability: { isAvailable: true },
    }),
    user({
      uuid: "user-kai",
      auth0Sub: "auth0|kai",
      firstName: "Kai",
      lastName: "Bennett",
      cmuEmail: "kbennett@andrew.cmu.edu",
      phone: "+14125551019",
      preferenceText: "Good package runner, currently finishing another task.",
      workerProfile: worker({
        categories: ["PACKAGE_PICKUP"],
        typicalLocations: ["UC", "Gates"],
        minPriceUsd: 8,
        preferredPriceUsd: 10,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 10,
        workerAvgRating: 4.7,
        ratingCount: 9,
        acceptanceRate: 0.8,
        completionRate: 0.9,
      }),
      availability: { isAvailable: false },
    }),
    user({
      uuid: "user-logan",
      auth0Sub: "auth0|logan",
      firstName: "Logan",
      lastName: "Adeyemi",
      cmuEmail: "ladeyemi@andrew.cmu.edu",
      phone: "+14125551020",
      preferenceText: "Cheap and fast food runs only. No packages, no moving.",
      workerProfile: worker({
        categories: ["FOOD_RUN"],
        excludedCategories: ["PACKAGE_PICKUP", "MOVING"],
        typicalLocations: ["Tepper", "Wean", "UC"],
        minPriceUsd: 5,
        preferredPriceUsd: 8,
      }),
      stats: emptyStats({
        tasksCompletedAsWorker: 15,
        workerAvgRating: 4.4,
        ratingCount: 14,
        acceptanceRate: 0.9,
        completionRate: 0.93,
      }),
      availability: { isAvailable: true },
    }),
  ];
}

function buildTasks(): Task[] {
  const sixPm = tomorrowAt(18);
  const eightPm = tomorrowAt(20);
  const now = new Date();

  return [
    {
      taskId: DEMO_TASK_ID,
      requesterUuid: DEMO_REQUESTER_UUID,
      rawText:
        "Need a package pickup from the UC to Gates before 6 PM, about 25 minutes, offering $10. Requires pickup authorization.",
      structured: {
        title: "UC → Gates package pickup",
        description:
          "Pick up a package from the UC and drop it at Gates before 6 PM.",
        category: "PACKAGE_PICKUP",
        pickupLocation: "UC",
        dropoffLocation: "Gates",
        deadline: sixPm,
        estimatedMinutes: 25,
        requirements: ["Pickup authorization"],
        categoryDetails: {
          kind: "PACKAGE_PICKUP",
          pickupLocation: "UC",
          dropoffLocation: "Gates",
          requiresAuthorization: true,
          packageSize: "MEDIUM",
        },
      },
      pricing: {
        initialOfferUsd: 10,
        maximumUsd: 16,
        agentMayIncreaseToUsd: 10,
        currentOfferUsd: 10,
        currency: "USD",
      },
      relaxationPlan: [
        {
          step: 1,
          deadline: sixPm,
          proposedPriceUsd: 12,
          requiresRequesterApproval: true,
          status: "UNTRIED",
        },
        {
          step: 2,
          deadline: eightPm,
          proposedPriceUsd: 9,
          requiresRequesterApproval: true,
          status: "UNTRIED",
        },
      ],
      ethics: {
        allowed: true,
        risk: "LOW",
        reasons: ["Ordinary campus delivery"],
        reviewedAt: now,
      },
      taskEmbedding: [],
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
    },
    {
      taskId: "task-food-run",
      requesterUuid: DEMO_REQUESTER_UUID,
      rawText:
        "Can someone grab my entree from Tepper and bring it to Wean? About 15 minutes, offering $8.",
      structured: {
        title: "Tepper → Wean food run",
        description: "Pick up food at Tepper and deliver it to Wean.",
        category: "FOOD_RUN",
        pickupLocation: "Tepper",
        dropoffLocation: "Wean",
        deadline: tomorrowAt(13),
        estimatedMinutes: 15,
        requirements: [],
        categoryDetails: {
          kind: "FOOD_RUN",
          vendor: "Tepper",
          pickupLocation: "Tepper",
          dropoffLocation: "Wean",
          orderSummary: "One entree",
          needsPaymentOnPickup: true,
        },
      },
      pricing: {
        initialOfferUsd: 8,
        maximumUsd: 14,
        agentMayIncreaseToUsd: 10,
        currentOfferUsd: 8,
        currency: "USD",
      },
      relaxationPlan: [
        {
          step: 1,
          deadline: tomorrowAt(13, 30),
          proposedPriceUsd: 10,
          requiresRequesterApproval: false,
          status: "UNTRIED",
        },
      ],
      ethics: {
        allowed: true,
        risk: "LOW",
        reasons: ["Ordinary food delivery"],
        reviewedAt: now,
      },
      taskEmbedding: [],
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
    },
    {
      taskId: "task-move-fridge",
      requesterUuid: "user-emerson",
      rawText:
        "Need help moving a mini fridge from Morewood to Donner this evening, offering $25.",
      structured: {
        title: "Morewood → Donner mini fridge move",
        description: "Carry a mini fridge from Morewood to Donner.",
        category: "MOVING",
        pickupLocation: "Morewood",
        dropoffLocation: "Donner",
        deadline: tomorrowAt(21),
        estimatedMinutes: 40,
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
        initialOfferUsd: 25,
        maximumUsd: 40,
        agentMayIncreaseToUsd: 30,
        currentOfferUsd: 25,
        currency: "USD",
      },
      relaxationPlan: [
        {
          step: 1,
          deadline: tomorrowAt(22),
          proposedPriceUsd: 22,
          requiresRequesterApproval: true,
          status: "UNTRIED",
        },
      ],
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
    },
  ];
}

async function main() {
  loadEnv();
  await ensureSchema();

  const users = buildUsers();
  for (const seeded of users) {
    await upsertUser(seeded);
  }

  const tasks = buildTasks();
  for (const seeded of tasks) {
    await upsertTask(seeded);
  }

  console.log(`Seeded ${users.length} users and ${tasks.length} tasks.`);
  console.log(`Demo task: ${DEMO_TASK_ID} requested by ${DEMO_REQUESTER_UUID}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
