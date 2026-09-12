import { loadEnv } from "./load-env";
import { checkIMessageHealth, sendIMessage } from "../src/lib/messaging/imessage";

async function main() {
  loadEnv();
  const health = await checkIMessageHealth();
  console.log("health", JSON.stringify(health));

  const dry = await sendIMessage({
    to: "++1-555-0045",
    text: "Gotchu dry-run connectivity check.",
    dryRun: true,
    idempotencyKey: "gotchu-dry-run-health-check",
  });
  console.log("dryRun", JSON.stringify(dry));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
