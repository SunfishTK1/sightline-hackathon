/**
 * @owner Daphne — outdoor CMU pins for the task map.
 * Coords copied from market-maker campus-travel (do not import or edit that file).
 * No indoor maps.
 */

export type CampusBuilding = {
  name: string;
  lat: number;
  lng: number;
  aliases: string[];
};

export const CAMPUS_BUILDINGS: CampusBuilding[] = [
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

export const CAMPUS_CENTER = { lat: 40.4436, lng: -79.9444 };

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ");
}

export function resolveBuilding(raw?: string | null): CampusBuilding | null {
  if (!raw) return null;
  const needle = normalize(raw);
  if (!needle) return null;
  let best: CampusBuilding | null = null;
  let bestLen = 0;
  for (const place of CAMPUS_BUILDINGS) {
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
