import { newId } from "@/lib/ids";
import { distanceBucket, durationBucket } from "@/lib/market/campus-travel";
import { query } from "./client";

export async function replaceSeedComps(): Promise<void> {
  await query("DELETE FROM market_comps WHERE source = 'seed'");
}

export interface MarketComp {
  category: string;
  pickup?: string | null;
  dropoff?: string | null;
  distanceM?: number | null;
  durationMin?: number | null;
  paidUsd: number;
  orderId?: string | null;
  source?: string;
}

export async function insertMarketComp(comp: MarketComp): Promise<void> {
  if (!(comp.paidUsd > 0)) return;
  await query(
    `INSERT INTO market_comps (
       comp_id, category, pickup, dropoff, distance_m, duration_min,
       paid_usd, order_id, source, agreed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [
      newId("comp"),
      comp.category,
      comp.pickup ?? null,
      comp.dropoff ?? null,
      comp.distanceM ?? null,
      comp.durationMin ?? null,
      comp.paidUsd,
      comp.orderId ?? null,
      comp.source ?? "broker",
    ],
  );
}

/** Paid prices for similar category + hop length + duration. */
export async function listSimilarComps(input: {
  category: string;
  distanceM: number;
  durationMin: number;
  limit?: number;
}): Promise<number[]> {
  const distance = distanceBucket(input.distanceM);
  const duration = durationBucket(input.durationMin);
  const result = await query<{ paid: string }>(
    `SELECT paid_usd::text AS paid
     FROM market_comps
     WHERE category = $1
       AND (distance_m IS NULL OR distance_m BETWEEN $2 AND $3)
       AND (duration_min IS NULL OR duration_min BETWEEN $4 AND $5)
     ORDER BY
       CASE WHEN distance_m IS NOT NULL AND duration_min IS NOT NULL THEN 0 ELSE 1 END,
       agreed_at DESC
     LIMIT $6`,
    [
      input.category,
      distance.low,
      distance.high,
      duration.low,
      duration.high,
      input.limit ?? 20,
    ],
  );
  return result.rows
    .map((row) => Number(row.paid))
    .filter((value) => Number.isFinite(value) && value > 0);
}

