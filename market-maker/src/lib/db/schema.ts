import { readFileSync } from "fs";
import { resolve } from "path";
import { query } from "./client";

export async function ensureSchema(): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  await query(sql);
}
