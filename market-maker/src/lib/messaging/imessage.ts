const DEFAULT_BASE_URL = "https://imessage.velroi.com";

export type IMessageService = "iMessage" | "SMS" | "auto";

export interface SendMessageInput {
  to: string;
  text: string;
  service?: IMessageService;
  dryRun?: boolean;
  idempotencyKey: string;
}

export interface SendMessageResult {
  status: string;
  service?: string;
  requestId?: string;
  providerMessageId?: string;
  submittedAt?: string;
  dryRun: boolean;
}

function baseUrl(): string {
  return (process.env.IMESSAGE_API_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.IMESSAGE_API_KEY;
  if (!key) {
    throw new Error("IMESSAGE_API_KEY is not set");
  }
  return key;
}

export function isLiveMessaging(): boolean {
  return process.env.IMESSAGE_LIVE === "true";
}

async function imessageFetch(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey()}`);
  headers.set("User-Agent", "gotchu-market/1.0");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }

  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
}

export async function checkIMessageHealth(): Promise<{
  ok: boolean;
  health?: unknown;
  readiness?: unknown;
}> {
  const health = await fetch(`${baseUrl()}/health`, {
    headers: { "User-Agent": "gotchu-market/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  const healthBody = await health.json().catch(() => null);

  const readiness = await imessageFetch("/v1/readiness");
  const readinessBody = await readiness.json().catch(() => null);

  return {
    ok: health.ok && readiness.ok,
    health: healthBody,
    readiness: readinessBody,
  };
}

export async function enrollRecipient(phone: string): Promise<void> {
  const response = await imessageFetch("/v1/recipients", {
    method: "POST",
    body: JSON.stringify({ recipient: phone, consent: true }),
  });
  if (!response.ok && response.status !== 409) {
    const body = await response.text();
    throw new Error(`Failed to enroll ${phone}: ${response.status} ${body}`);
  }
}

export async function sendIMessage(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const dryRun = input.dryRun ?? !isLiveMessaging();
  const response = await imessageFetch("/v1/messages", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: JSON.stringify({
      to: input.to,
      text: input.text,
      service: input.service ?? "auto",
      consent: true,
      dryRun,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as SendMessageResult & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      body.error ?? `iMessage send failed with HTTP ${response.status}`,
    );
  }
  return { ...body, dryRun };
}

export interface InboundEvent {
  sequence: number;
  id: string;
  type: string;
  createdAt: string;
  data: {
    providerMessageId?: string;
    sender?: string;
    body?: string | null;
    receivedAt?: string;
    requestId?: string;
    delivery?: { status?: string };
  };
}

export async function listIMessageEvents(after: number): Promise<{
  events: InboundEvent[];
  nextCursor: number;
}> {
  const response = await imessageFetch(
    `/v1/events?after=${encodeURIComponent(String(after))}&limit=100`,
  );
  if (!response.ok) {
    throw new Error(`Failed to poll iMessage events: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    events?: InboundEvent[];
    nextCursor?: number;
  };
  return {
    events: body.events ?? [],
    nextCursor: body.nextCursor ?? after,
  };
}
