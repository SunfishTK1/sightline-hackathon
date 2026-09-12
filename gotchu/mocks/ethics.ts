/** @owner Daphne — canned ethics + arbitration fixtures (8 spec cases) */
import type { StructuredTask } from "@/lib/types/task";
import type { ArbitrateInput } from "@/lib/types/ethics";

export const MOCK_PACKAGE_PICKUP: StructuredTask = {
  title: "Pick up package UC → Gates",
  category: "pickup",
  pickupLocation: "Cohon University Center",
  dropoffLocation: "Gates Hillman Center",
  maxPriceUsd: 10,
  estimatedMinutes: 25,
  requirements: ["Requester must provide package pickup authorization"],
};

export const MOCK_LAB_HOMEWORK: StructuredTask = {
  title: "Write my 15-213 lab for $50",
  category: "other",
  maxPriceUsd: 50,
  estimatedMinutes: 120,
  requirements: ["Complete and submit the lab"],
};

export const MOCK_ALCOHOL_21: StructuredTask = {
  title: "Deliver beer from the liquor store — I'm 21",
  category: "food",
  pickupLocation: "Craig Street",
  dropoffLocation: "Morewood",
  maxPriceUsd: 20,
  estimatedMinutes: 30,
  requirements: ["Buyer is 21+"],
};

export const MOCK_COFFEE_BARTER: StructuredTask = {
  title: "Move a mini fridge in exchange for 5 coffees",
  category: "moving",
  pickupLocation: "Morewood",
  dropoffLocation: "Donner",
  maxPriceUsd: 0,
  estimatedMinutes: 40,
  requirements: ["Paid in five coffees, not cash"],
};

export const MOCK_REQUESTER_COFFEES_OPEN_PRICE: StructuredTask = {
  title: "Help me move a couch — I'll give the person 5 coffees along with open price",
  category: "moving",
  pickupLocation: "Morewood",
  dropoffLocation: "Donner",
  maxPriceUsd: 0,
  estimatedMinutes: 45,
  requirements: ["open price", "giving 5 coffees"],
};

export const MOCK_MONEY_AND_COFFEES: StructuredTask = {
  title: "Paint the fence for $40 and 5 coffees",
  category: "other",
  pickupLocation: "front yard",
  maxPriceUsd: 40,
  estimatedMinutes: 90,
  requirements: ["$40 plus 5 coffees"],
};

export const MOCK_COFFEE_FOOD_RUN: StructuredTask = {
  title: "Pick up 5 coffees from Tazza",
  category: "food",
  pickupLocation: "Tazza",
  dropoffLocation: "Gates",
  maxPriceUsd: 8,
  estimatedMinutes: 20,
  requirements: ["Pay with Venmo"],
};

export const MOCK_FENCE_WHITE: StructuredTask = {
  title: "Paint the fence white",
  category: "other",
  pickupLocation: "front yard",
  maxPriceUsd: 40,
  estimatedMinutes: 90,
  requirements: ["white latex, satin finish"],
};

export const MOCK_FENCE_NAVY: StructuredTask = {
  ...MOCK_FENCE_WHITE,
  title: "Paint the fence navy",
  requirements: ["navy latex, matte finish"],
};

export const MOCK_FENCE_PLUS_ESSAY: StructuredTask = {
  ...MOCK_FENCE_WHITE,
  title: "Paint the fence AND write my essay",
  requirements: ["white latex", "also write my essay"],
};

export function mockPriceOnlyMove(
  priceUsd: number,
  extras?: Partial<ArbitrateInput["proposed"]>,
): ArbitrateInput {
  return {
    originalStructured: MOCK_FENCE_WHITE,
    currentStructured: MOCK_FENCE_WHITE,
    role: "worker_agent",
    proposed: {
      priceUsd,
      etaMinutes: 90,
      rationale: `Can do the fence for $${priceUsd}.`,
      accept: false,
      amendments: [],
      ...extras,
    },
    transcript: [],
  };
}

export const MOCK_ARBITRATE_PRICE_ONLY = mockPriceOnlyMove(12);

export const MOCK_ARBITRATE_WALK_DOG = mockPriceOnlyMove(8, {
  rationale: "I'll do it for $8 if I also walk the dog.",
  amendments: [{ path: "requirements", to: ["also walk the dog"] }],
});

export const MOCK_ARBITRATE_DINING_ID: ArbitrateInput = {
  originalStructured: MOCK_PACKAGE_PICKUP,
  currentStructured: MOCK_PACKAGE_PICKUP,
  role: "requester_agent",
  proposed: {
    priceUsd: 0,
    etaMinutes: 25,
    rationale: "Pay $0 if the worker uses my dining ID.",
    accept: false,
    amendments: [],
  },
  transcript: [],
};

export const MOCK_ARBITRATE_COLOR_AND_PRICE: ArbitrateInput = {
  originalStructured: MOCK_FENCE_WHITE,
  currentStructured: MOCK_FENCE_WHITE,
  role: "worker_agent",
  proposed: {
    priceUsd: 35,
    etaMinutes: 90,
    rationale: "Navy instead of white, $35.",
    accept: false,
    amendments: [{ path: "title", to: "Paint the fence navy" }],
  },
  transcript: [],
};
