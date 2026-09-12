import { closePool } from "../src/lib/db/client";
import { ensureSchema } from "../src/lib/db/schema";
import { loadEnv } from "./load-env";

async function main() {
  loadEnv();
  await ensureSchema();
  console.log("Postgres schema ensured.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
