/**
 * @owner Daphne
 * Run the 8 canned ethics/arbitration cases. No API keys required.
 *
 *   npm run ethics-smoke
 */
import {
  parseEthicsStructured,
  reviewTask,
  reviewAmendment,
  arbitrateMove,
} from "../lib/agents/ethics";
import {
  MOCK_ALCOHOL_21,
  MOCK_COFFEE_BARTER,
  MOCK_BURGER_PAY_COFFEES,
  MOCK_BURGER_PAY_COOKIES,
  MOCK_HOODIE_BARTER,
  MOCK_COFFEE_FOOD_RUN,
  MOCK_MONEY_AND_COFFEES,
  MOCK_REQUESTER_COFFEES_OPEN_PRICE,
  MOCK_ARBITRATE_COLOR_AND_PRICE,
  MOCK_ARBITRATE_DINING_ID,
  MOCK_ARBITRATE_PRICE_ONLY,
  MOCK_ARBITRATE_WALK_DOG,
  MOCK_FENCE_NAVY,
  MOCK_FENCE_PLUS_ESSAY,
  MOCK_FENCE_WHITE,
  MOCK_LAB_HOMEWORK,
  MOCK_PACKAGE_PICKUP,
} from "../mocks/ethics";

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${name}`, detail ?? "");
}

async function main() {
  const pickup = await reviewTask(MOCK_PACKAGE_PICKUP);
  check(
    "1 reviewTask package pickup BLOCK credential_misuse",
    pickup.verdict === "BLOCK" && pickup.categories.includes("credential_misuse"),
    pickup,
  );

  const lab = await reviewTask(MOCK_LAB_HOMEWORK);
  check(
    "2 reviewTask 15-213 lab BLOCK academic_integrity",
    lab.verdict === "BLOCK" && lab.categories.includes("academic_integrity"),
    lab,
  );

  const alcohol = await reviewTask(MOCK_ALCOHOL_21);
  check(
    "2b reviewTask beer delivery at 21 BLOCK controlled_substances",
    alcohol.verdict === "BLOCK" && alcohol.categories.includes("controlled_substances"),
    alcohol,
  );

  const barter = await reviewTask(MOCK_COFFEE_BARTER);
  check(
    "2c reviewTask 5 coffees barter BLOCK financial_risk",
    barter.verdict === "BLOCK" && barter.categories.includes("financial_risk"),
    barter,
  );

  const requesterBarter = await reviewAmendment(
    MOCK_FENCE_WHITE,
    MOCK_REQUESTER_COFFEES_OPEN_PRICE,
  );
  check(
    "2d reviewAmendment requester adds 5 coffees + open price REJECT",
    requesterBarter.verdict === "REJECT",
    requesterBarter,
  );

  const moneyAndCoffee = await reviewTask(MOCK_MONEY_AND_COFFEES);
  check(
    "2e reviewTask $40 and 5 coffees BLOCK (no mixed pay)",
    moneyAndCoffee.verdict === "BLOCK" &&
      moneyAndCoffee.categories.includes("financial_risk"),
    moneyAndCoffee,
  );

  const coffeeRun = await reviewTask(MOCK_COFFEE_FOOD_RUN);
  check(
    "2f reviewTask pick up coffees for USD ALLOW or ALLOW_WITH_CONDITIONS",
    coffeeRun.verdict === "ALLOW" || coffeeRun.verdict === "ALLOW_WITH_CONDITIONS",
    coffeeRun,
  );

  const burgerCoffees = await reviewTask(MOCK_BURGER_PAY_COFFEES);
  check(
    "2g reviewTask burger paid in 5 coffees BLOCK financial_risk",
    burgerCoffees.verdict === "BLOCK" &&
      burgerCoffees.categories.includes("financial_risk"),
    burgerCoffees,
  );

  const burgerCookies = await reviewTask(MOCK_BURGER_PAY_COOKIES);
  check(
    "2h reviewTask burger paid in 5 cookies BLOCK (any barter)",
    burgerCookies.verdict === "BLOCK" &&
      burgerCookies.categories.includes("financial_risk"),
    burgerCookies,
  );

  const hoodie = await reviewTask(MOCK_HOODIE_BARTER);
  check(
    "2i reviewTask fridge for a hoodie BLOCK financial_risk",
    hoodie.verdict === "BLOCK" && hoodie.categories.includes("financial_risk"),
    hoodie,
  );

  const navy = await reviewAmendment(MOCK_FENCE_WHITE, MOCK_FENCE_NAVY);
  check(
    "3 reviewAmendment white → navy ALLOW sameTask",
    navy.verdict === "ALLOW" && navy.sameTask === true,
    navy,
  );

  const essay = await reviewAmendment(MOCK_FENCE_WHITE, MOCK_FENCE_PLUS_ESSAY);
  check(
    "4 reviewAmendment fence + essay REJECT not same task",
    essay.verdict === "REJECT" && essay.sameTask === false,
    essay,
  );

  const priceOnly = await arbitrateMove(MOCK_ARBITRATE_PRICE_ONLY);
  check("5 arbitrateMove $12 no amendments ALLOW", priceOnly.verdict === "ALLOW", priceOnly);

  const dog = await arbitrateMove(MOCK_ARBITRATE_WALK_DOG);
  check(
    "6 arbitrateMove walk-the-dog STRIP or REJECT, job unchanged",
    (dog.verdict === "STRIP_AMENDMENTS" || dog.verdict === "REJECT_MOVE") &&
      dog.structured.title === MOCK_FENCE_WHITE.title,
    dog,
  );

  const dining = await arbitrateMove(MOCK_ARBITRATE_DINING_ID);
  check(
    "7 arbitrateMove dining ID BLOCK_TASK credential_misuse",
    dining.verdict === "BLOCK_TASK",
    dining,
  );

  const colorPrice = await arbitrateMove(MOCK_ARBITRATE_COLOR_AND_PRICE);
  check(
    "8 arbitrateMove navy + $35 ALLOW",
    colorPrice.verdict === "ALLOW" &&
      colorPrice.priceUsd === 35 &&
      /navy/i.test(colorPrice.structured.title),
    colorPrice,
  );

  // voice-mcp posts description (order details), not a StructuredTask
  // requirements array. Same-job check must still see that text.
  const fenceDetails = parseEthicsStructured({
    title: "Paint the fence white",
    category: "other",
    description: "white latex, satin finish, front yard",
    maxPriceUsd: 40,
  });
  const airportDetails = parseEthicsStructured({
    title: "Paint the fence white",
    category: "other",
    description: "Drive me to the airport instead",
    maxPriceUsd: 40,
  });
  check("9a parseEthicsStructured keeps description", Boolean(fenceDetails && airportDetails));
  if (fenceDetails && airportDetails) {
    const morph = await reviewAmendment(fenceDetails, airportDetails);
    check(
      "9b voice-mcp payload: fence details → airport REJECT",
      morph.verdict === "REJECT" && morph.sameTask === false,
      morph,
    );
  }

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nEthics smoke passed (including alcohol ban at any age).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
