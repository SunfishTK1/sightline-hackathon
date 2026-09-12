/**
 * @owner Will
 * Validation + API checks for onboarding (phone, uuid, andrew.cmu.edu).
 */
import { isCmuEmail, onboardingSchema } from "../lib/validate";
import { toE164, formatPhoneMask, isE164 } from "../lib/phone";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function section(name: string) {
  console.log(`\n▸ ${name}`);
}

const validConsents = {
  ageConfirmed: true,
  consentCall: true,
  consentText: true,
};

section("CMU email gate");
assert(isCmuEmail("will@andrew.cmu.edu"), "andrew.cmu.edu should pass");
assert(isCmuEmail("will@cmu.edu"), "cmu.edu should pass (Auth0 action)");
assert(!isCmuEmail("will@gmail.com"), "gmail should fail");
assert(!isCmuEmail("will@pitt.edu"), "pitt should fail");
assert(!isCmuEmail("will@andrew.cmu.edu.com"), "spoofed domain should fail");
console.log("  email checks ok");

section("E.164 phone");
assert(toE164("4125550123") === "+14125550123", "10-digit US → +1");
assert(toE164("14125550123") === "+14125550123", "11-digit US → +1");
assert(toE164("+1 (412) 555-0123") === "+14125550123", "masked US → E.164");
assert(toE164("555") === null, "too short rejected");
assert(isE164("+14125550123"), "canonical E.164");
assert(formatPhoneMask("4125550123") === "+1 (412) 555-0123", "mask");
console.log("  phone checks ok");

section("onboarding schema");
const good = onboardingSchema.safeParse({
  firstName: "Will",
  phone: "+1 (412) 555-0123",
  cmuEmail: "wmontagu@andrew.cmu.edu",
  ...validConsents,
});
assert(good.success, "valid payload should parse");
if (good.success) {
  assert(good.data.phone === "+14125550123", "phone stored as E.164");
  assert(good.data.cmuEmail === "wmontagu@andrew.cmu.edu", "email normalized");
}

const gmail = onboardingSchema.safeParse({
  firstName: "Will",
  phone: "+14125550123",
  cmuEmail: "will@gmail.com",
  ...validConsents,
});
assert(!gmail.success, "gmail must be rejected");

const noTerms = onboardingSchema.safeParse({
  firstName: "Will",
  phone: "+14125550123",
  cmuEmail: "wmontagu@andrew.cmu.edu",
  ageConfirmed: false,
  consentCall: true,
  consentText: true,
});
assert(!noTerms.success, "must accept 18+");
console.log("  schema checks ok");

async function runApiTests() {
  const base = process.env.ONBOARDING_TEST_URL;
  if (!base) {
    console.log("\nSet ONBOARDING_TEST_URL to also hit the live API.");
    return;
  }

  section(`API ${base}`);

  async function post(path: string, body: unknown, cookie?: string) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok: boolean;
      data?: { user?: { uuid?: string; phone?: string; cmuEmail?: string } };
      error?: string;
    };
    return { res, json, cookie: res.headers.get("set-cookie") };
  }

  const gmailRes = await post("/api/onboarding", {
    firstName: "Will",
    phone: "+14125550123",
    cmuEmail: "will@gmail.com",
    ...validConsents,
  });
  assert(gmailRes.json.ok === false, "API rejects gmail");
  console.log("  rejected gmail");

  const created = await post("/api/onboarding", {
    firstName: "Will",
    phone: "4125550123",
    cmuEmail: "wmontagu@andrew.cmu.edu",
    ...validConsents,
  });
  assert(created.json.ok, `create failed: ${created.json.error}`);
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(created.json.data?.user?.uuid ?? ""),
    "uuid must be a real uuid (people.id)",
  );
  assert(created.json.data?.user?.phone === "+14125550123", "API stores E.164");
  console.log(`  created ${created.json.data?.user?.uuid}`);

  const again = await post(
    "/api/onboarding",
    {
      firstName: "Will",
      phone: "+14125550123",
      cmuEmail: "wmontagu@andrew.cmu.edu",
      ...validConsents,
    },
    created.cookie ?? undefined,
  );
  assert(again.json.ok, `upsert failed: ${again.json.error}`);
  assert(
    again.json.data?.user?.uuid === created.json.data?.user?.uuid,
    "upsert must keep the same uuid",
  );
  console.log("  upsert kept uuid");
}

runApiTests()
  .then(() => {
    console.log("\nAll onboarding checks passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
