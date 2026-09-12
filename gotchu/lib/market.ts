/**
 * The live marketplace. Accounts, tasks, offers and workers all live in the
 * voice-mcp service's Postgres, which is the same data the phone agent reads
 * and writes - so signing up here puts a person into the actual system rather
 * than a second copy of it.
 *
 * Server-side only. Every call is made with the caller's Auth0 subject, which
 * this app reads from the session and the client never supplies.
 */
const BASE_URL = (process.env.MARKET_API_URL || "").replace(/\/$/, "");

export type SignupStatus = {
  id: string;
  phone: string;
  display_name: string | null;
  email: string | null;
  phone_verified: boolean;
  signed_up_at: string | null;
  is_available: boolean | null;
  blurb: string | null;
  categories: string[] | null;
  min_price_usd: string | null;
  requests_made: number;
  jobs_taken: number;
};

type Envelope<T> = { ok: boolean; data?: T; error?: string };

class MarketError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  if (!BASE_URL) {
    throw new MarketError("The marketplace service is not configured.", "not_configured");
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MarketError("The marketplace service is unreachable.", "unreachable");
  }
  const parsed = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || parsed.ok === false) {
    throw new MarketError(parsed.error ?? `request failed (${res.status})`, parsed.error ?? "failed");
  }
  return parsed.data as T;
}

export { MarketError };

export function marketConfigured(): boolean {
  return Boolean(BASE_URL);
}

export async function createSignup(input: {
  auth0_sub: string;
  email: string;
  display_name?: string;
  phone: string;
  blurb?: string;
  categories?: string[];
  min_price_usd?: number;
  wants_work?: boolean;
}) {
  return call<{ verified: boolean; code_sent: boolean; person: { phone: string } }>("/v1/signup", {
    method: "POST",
    body: input,
  });
}

export async function verifyPhone(auth0_sub: string, code: string) {
  return call<{ verified: boolean; phone: string }>("/v1/signup/verify", {
    method: "POST",
    body: { auth0_sub, code },
  });
}

export async function getSignupStatus(auth0_sub: string) {
  return call<SignupStatus | null>(
    `/v1/signup/status?auth0_sub=${encodeURIComponent(auth0_sub)}`,
  );
}

export async function setAvailable(auth0_sub: string, available: boolean) {
  return call<{ is_available: boolean }>("/v1/signup/availability", {
    method: "POST",
    body: { auth0_sub, available },
  });
}

/** Tasks currently looking for someone. Used by the feed. */
export async function openTasks() {
  return call<
    Array<{
      id: string;
      title: string;
      details: string;
      category: string | null;
      pickup_location: string | null;
      dropoff_location: string | null;
      budget_usd: string | null;
      urgency: string | null;
      created_at: string;
    }>
  >("/v1/orders/open");
}
