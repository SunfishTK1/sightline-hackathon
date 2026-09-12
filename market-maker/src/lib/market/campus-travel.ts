import { mapCategory } from "./map-category";
import type { TaskCategory } from "./types";

type Place = { name: string; lat: number; lng: number; aliases: string[] };

/** Named CMU / nearby spots. Distances are haversine, times are campus-pace. */
const PLACES: Place[] = [
  { name: "Gates", lat: 40.4436, lng: -79.9444, aliases: ["gates", "ghc", "gates hillman", "hillman"] },
  { name: "Wean", lat: 40.4428, lng: -79.9458, aliases: ["wean", "wean hall"] },
  { name: "Doherty", lat: 40.4424, lng: -79.9445, aliases: ["doherty", "doherty hall"] },
  { name: "Baker", lat: 40.4414, lng: -79.9455, aliases: ["baker", "porter", "baker porter"] },
  { name: "Hunt", lat: 40.4411, lng: -79.9437, aliases: ["hunt", "hunt library"] },
  { name: "Tepper", lat: 40.4453, lng: -79.9455, aliases: ["tepper", "tepper quad", "the exchange"] },
  { name: "UC", lat: 40.4432, lng: -79.9418, aliases: ["uc", "cohon", "university center", "cohon university center"] },
  { name: "Morewood", lat: 40.4456, lng: -79.9433, aliases: ["morewood", "morewood gardens", "e-tower", "e tower"] },
  { name: "Donner", lat: 40.4468, lng: -79.9415, aliases: ["donner"] },
  { name: "Stever", lat: 40.4472, lng: -79.941, aliases: ["stever"] },
  { name: "Mudge", lat: 40.4469, lng: -79.943, aliases: ["mudge"] },
  { name: "Resnik", lat: 40.4465, lng: -79.9395, aliases: ["resnik"] },
  { name: "Hamerschlag", lat: 40.4423, lng: -79.9468, aliases: ["hamerschlag", "hamerschlag hall"] },
  { name: "CFA", lat: 40.4415, lng: -79.943, aliases: ["cfa", "college of fine arts"] },
  { name: "Purnell", lat: 40.4438, lng: -79.9432, aliases: ["purnell"] },
  { name: "Mellon Institute", lat: 40.4462, lng: -79.951, aliases: ["mellon institute", "mellon"] },
  { name: "Craig", lat: 40.4445, lng: -79.9485, aliases: ["craig", "craig street"] },
  { name: "The Cut", lat: 40.4428, lng: -79.9432, aliases: ["the cut", "cut"] },
  { name: "The Fence", lat: 40.4424, lng: -79.9435, aliases: ["fence", "the fence"] },
  { name: "Entropy", lat: 40.4432, lng: -79.9418, aliases: ["entropy"] },
  { name: "Tazza", lat: 40.4436, lng: -79.9444, aliases: ["tazza", "tazza d'oro"] },
  { name: "Fifth and Clyde", lat: 40.4475, lng: -79.945, aliases: ["fifth and clyde", "fifth & clyde"] },
  { name: "Webster", lat: 40.4485, lng: -79.948, aliases: ["webster", "webster hall"] },
  { name: "Squirrel Hill", lat: 40.438, lng: -79.923, aliases: ["squirrel hill", "murray", "murray avenue"] },
  { name: "Shadyside", lat: 40.452, lng: -79.934, aliases: ["shadyside"] },
  { name: "Flagstaff", lat: 40.44, lng: -79.942, aliases: ["flagstaff", "schenley", "schenley park"] },
];

const OFF_CAMPUS = new Set(["Squirrel Hill", "Shadyside"]);

export type TravelMode = "walk" | "drive" | "bus";
export type TravelFeasibility = "OK" | "TIGHT" | "INFEASIBLE";

export interface TravelEstimate {
  from: string;
  to: string;
  fromName: string | null;
  toName: string | null;
  known: boolean;
  distanceM: number;
  distanceMi: number;
  walkMin: number;
  driveMin: number;
  busMin: number;
  recommended: TravelMode;
  line: string;
}

export interface JobTravel extends TravelEstimate {
  workMin: number;
  totalMin: number;
  fastestMin: number;
  slackMin: number | null;
  feasibility: TravelFeasibility;
  suggestedDeadline: Date | null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ");
}

export function resolvePlace(raw?: string | null): Place | null {
  if (!raw) return null;
  const needle = normalize(raw);
  if (!needle) return null;
  let best: Place | null = null;
  let bestLen = 0;
  for (const place of PLACES) {
    for (const alias of [normalize(place.name), ...place.aliases]) {
      if (needle === alias || needle.includes(alias) || alias.includes(needle)) {
        if (alias.length > bestLen) {
          best = place;
          bestLen = alias.length;
        }
      }
    }
  }
  return best;
}

function haversineM(a: Place, b: Place): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function minutes(value: number): number {
  return Math.max(0, Math.round(value));
}

export function estimateTravel(
  fromRaw?: string | null,
  toRaw?: string | null,
  category?: string | null,
): TravelEstimate {
  const from = (fromRaw ?? "").trim();
  const to = (toRaw ?? "").trim();
  const fromPlace = resolvePlace(from);
  const toPlace = resolvePlace(to);
  // Boolean(), or the && chain yields string | boolean and `known` stops
  // being a boolean.
  const sameText = Boolean(from && to && normalize(from) === normalize(to));
  const samePlace = fromPlace && toPlace && fromPlace.name === toPlace.name;

  let distanceM = 0;
  let known = Boolean(fromPlace && toPlace) || sameText;
  if (sameText || samePlace) {
    distanceM = 0;
  } else if (fromPlace && toPlace) {
    distanceM = haversineM(fromPlace, toPlace);
  } else if (from || to) {
    known = false;
    distanceM = 900;
  }

  const walkMin = distanceM <= 40 ? 0 : minutes(distanceM / 80 + 1);
  const driveMin = distanceM <= 40 ? 0 : minutes(Math.max(3, distanceM / 250 + 4));
  const busMin = distanceM <= 40 ? 0 : minutes(Math.max(8, distanceM / 180 + 6));
  const mapped = mapCategory(category);
  const offCampus = Boolean(
    (fromPlace && OFF_CAMPUS.has(fromPlace.name)) ||
      (toPlace && OFF_CAMPUS.has(toPlace.name)),
  );
  const recommended: TravelMode =
    mapped === "MOVING" && distanceM > 400
      ? "drive"
      : offCampus || walkMin > 20
        ? "bus"
        : "walk";

  const distanceMi = Math.round((distanceM / 1609.34) * 100) / 100;
  const line = known
    ? `${distanceMi} mi · walk ${walkMin} min · bus ${busMin} min · drive ${driveMin} min`
    : `~campus hop · walk ~${walkMin} min (place not pinned)`;

  return {
    from: from || "unspecified",
    to: to || from || "unspecified",
    fromName: fromPlace?.name ?? null,
    toName: toPlace?.name ?? null,
    known,
    distanceM: Math.round(distanceM),
    distanceMi,
    walkMin,
    driveMin,
    busMin,
    recommended,
    line,
  };
}

export function defaultWorkMinutes(category?: string | null): number {
  const mapped = mapCategory(category);
  const defaults: Record<TaskCategory, number> = {
    FOOD_RUN: 8,
    PACKAGE_PICKUP: 10,
    CAMPUS_ERRAND: 12,
    MOVING: 20,
    TUTORING: 45,
    OTHER: 15,
  };
  return defaults[mapped];
}

export function recommendedMinutes(travel: TravelEstimate): number {
  if (travel.recommended === "drive") return travel.driveMin;
  if (travel.recommended === "bus") return travel.busMin;
  return travel.walkMin;
}

export function estimateJobTravel(input: {
  pickup?: string | null;
  dropoff?: string | null;
  category?: string | null;
  deadlineAt?: string | Date | null;
  estimatedMinutes?: number | null;
  now?: Date;
}): JobTravel {
  const travel = estimateTravel(input.pickup, input.dropoff, input.category);
  const workMin = input.estimatedMinutes && input.estimatedMinutes > 0
    ? input.estimatedMinutes
    : defaultWorkMinutes(input.category);
  const modeMin = recommendedMinutes(travel);
  const fastestMin = Math.min(travel.walkMin, travel.driveMin || travel.walkMin, travel.busMin || travel.walkMin);
  const totalMin = modeMin + workMin;
  const now = input.now ?? new Date();
  const deadline = input.deadlineAt ? new Date(input.deadlineAt) : null;
  const validDeadline = deadline && !Number.isNaN(deadline.getTime()) ? deadline : null;
  const remainingMin = validDeadline
    ? Math.round((validDeadline.getTime() - now.getTime()) / 60_000)
    : null;
  const slackMin = remainingMin == null ? null : remainingMin - totalMin;

  let feasibility: TravelFeasibility = "OK";
  if (remainingMin != null) {
    if (remainingMin < fastestMin + workMin - 5) feasibility = "INFEASIBLE";
    else if (remainingMin < totalMin + 8) feasibility = "TIGHT";
  }

  const suggestedDeadline =
    feasibility !== "OK"
      ? new Date(now.getTime() + (totalMin + 15) * 60_000)
      : null;

  return {
    ...travel,
    workMin,
    totalMin,
    fastestMin,
    slackMin,
    feasibility,
    suggestedDeadline,
  };
}

export function distanceBucket(distanceM: number): { low: number; high: number } {
  if (distanceM < 350) return { low: 0, high: 450 };
  if (distanceM < 800) return { low: 250, high: 1100 };
  if (distanceM < 1600) return { low: 700, high: 2100 };
  return { low: 1400, high: 10_000 };
}

export function durationBucket(minutes: number): { low: number; high: number } {
  if (minutes < 20) return { low: 0, high: 25 };
  if (minutes < 45) return { low: 15, high: 55 };
  if (minutes < 90) return { low: 40, high: 110 };
  return { low: 75, high: 240 };
}

/** Extra dollars when the hop is farther/longer than a next-door campus job. */
export function effortPremium(distanceM: number, durationMin: number): number {
  const extraBlocks = Math.max(0, distanceM - 400) / 500;
  const extraTime = Math.max(0, durationMin - 15) / 20;
  return Math.round((extraBlocks * 1.25 + extraTime * 1) * 100) / 100;
}

export function formatTravelSms(travel: JobTravel): string {
  const modes = `walk ${travel.walkMin} min, bus ${travel.busMin} min, drive ${travel.driveMin} min`;
  if (!travel.known) return `Travel is a guess (${modes}).`;
  return `${travel.distanceMi} mi: ${modes}.`;
}

export function serializeTravel(travel: JobTravel) {
  return {
    from: travel.from,
    to: travel.to,
    known: travel.known,
    distanceM: travel.distanceM,
    distanceMi: travel.distanceMi,
    walkMin: travel.walkMin,
    driveMin: travel.driveMin,
    busMin: travel.busMin,
    recommended: travel.recommended,
    line: travel.line,
    workMin: travel.workMin,
    totalMin: travel.totalMin,
    slackMin: travel.slackMin,
    feasibility: travel.feasibility,
    suggestedDeadline: travel.suggestedDeadline?.toISOString() ?? null,
  };
}

export type SerializedTravel = ReturnType<typeof serializeTravel>;
