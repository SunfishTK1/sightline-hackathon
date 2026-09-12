import {
  attachLiveMedia,
  claimLiveMedia,
  liveBoardJob,
  markLiveMediaFailed,
  recordLiveEvent,
  releaseLiveMedia,
  setLiveMediaProgress,
} from "@/lib/db/live";
import { ensureBucket, getObject, storageConfigured } from "@/lib/storage/s3";

const IMAGE_URL = "https://api.openai.com/v1/images/generations";
const VIDEO_URL = "https://api.openai.com/v1/videos";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
const VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL || "sora-2";
const VIDEO_SECONDS = process.env.OPENAI_VIDEO_SECONDS || "4";
const VIDEO_SIZE = process.env.OPENAI_VIDEO_SIZE || "720x1280";

const CAMPUS_LOOK = [
  "Setting: the Carnegie Mellon University campus in Pittsburgh.",
  "The buildings are warm buff and yellow-tan brick with pale stone trim, in a restrained Beaux-Arts style: rectangular blocks, tall repeated windows, heavy cornices, some with muted green tiled roofs.",
  "The open space is the Cut, a broad elongated lawn crossed by paved diagonal walks with mature trees along the edges.",
  "The terrain is hilly urban Pittsburgh, green and leafy.",
  "Do not draw red brick, white columns, a clock tower, Gothic spires, or an Ivy League village.",
].join(" ");

const inflight = new Set<string>();

function openaiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

function jobFromTitle(title: string, category: string | null): {
  pickup: string | null;
  dropoff: string | null;
} {
  const match = title.match(/(.+?)\s*(?:→|->|to)\s*(.+?)(?:\s+food|\s+run|$)/i);
  return {
    pickup: match?.[1]?.trim() ?? null,
    dropoff: match?.[2]?.replace(/\s+food.*$/i, "").trim() ?? null,
  };
}

function imagePrompt(title: string, category: string | null): string {
  const { pickup, dropoff } = jobFromTitle(title, category);
  const route =
    pickup && dropoff
      ? `being carried from ${pickup} to ${dropoff} across a university campus`
      : "on a university campus";
  return [
    `A clean, friendly flat illustration showing this task: ${title}.`,
    category ? `Category: ${category}.` : "",
    `Show the actual object or activity involved, ${route}.`,
    "Show the students who use this campus as they actually are, varied and unremarkable.",
    CAMPUS_LOOK,
    "Style: clean flat illustration, simple shapes, muted natural colours, soft daylight.",
    "No text, no lettering, no numbers, no signage, no logos, no watermarks.",
    "One clear subject, uncluttered background.",
  ]
    .filter(Boolean)
    .join(" ");
}

function videoPrompt(title: string, category: string | null): string {
  const { dropoff } = jobFromTitle(title, category);
  const arrival = dropoff
    ? `arriving at ${dropoff} and handing it over`
    : "arriving and handing it over";
  return [
    `Photorealistic cinematic footage of a campus errand being pulled off: ${title}.`,
    category ? `Category: ${category}.` : "",
    `The person doing it moves with total purpose, ${arrival} to another student who takes it and nods.`,
    "Show the students who use this campus as they actually are, varied and unremarkable.",
    CAMPUS_LOOK,
    "Shoot it like the climax of a spy thriller: low hero angles, a fast push-in on the handover, a slow-motion beat as the object changes hands, tight cuts, lens flare, shallow depth of field.",
    "Photoreal, natural daylight, realistic textures and motion.",
    "No text, no captions, no logos, no watermarks, no on-screen graphics.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function pullVoiceMedia(
  orderId: string,
  kind: "image" | "video",
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const base = process.env.VOICE_MCP_URL?.replace(/\/$/, "");
  if (!base || !/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  try {
    const response = await fetch(`${base}/v1/orders/${orderId}/${kind}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { png_base64?: string; mp4_base64?: string; storage_key?: string | null };
    };
    const contentType = kind === "image" ? "image/png" : "video/mp4";

    // voice-mcp moved its media into object storage, so the inline base64 is
    // null for anything recent and only a key comes back. Without following it
    // the reuse path silently found nothing and this board re-generated a clip
    // that already existed - minutes of Sora time per task, for nothing.
    const key = body.data?.storage_key;
    if (key) {
      const bytes = await getObject(key);
      if (bytes) return { bytes, contentType };
      return null;
    }

    const b64 = kind === "image" ? body.data?.png_base64 : body.data?.mp4_base64;
    if (!b64) return null;
    return { bytes: Buffer.from(b64, "base64"), contentType };
  } catch {
    return null;
  }
}

async function generateImage(prompt: string): Promise<Buffer | null> {
  const key = openaiKey();
  if (!key) return null;
  const models = [IMAGE_MODEL, "gpt-image-1", "dall-e-3"];
  for (const model of [...new Set(models)]) {
    const response = await fetch(IMAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1 }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      console.error(`live image ${model} failed: HTTP ${response.status}`);
      continue;
    }
    const body = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = body.data?.[0];
    if (first?.b64_json) return Buffer.from(first.b64_json, "base64");
    if (first?.url) {
      const png = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
      if (png.ok) return Buffer.from(await png.arrayBuffer());
    }
  }
  return null;
}

async function generateVideo(
  prompt: string,
  onProgress: (progress: number) => Promise<void>,
): Promise<Buffer | null> {
  const key = openaiKey();
  if (!key) return null;
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const started = await fetch(VIDEO_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: VIDEO_MODEL,
      prompt,
      seconds: VIDEO_SECONDS,
      size: VIDEO_SIZE,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!started.ok) {
    console.error(`live video failed: HTTP ${started.status}`);
    return null;
  }
  const job = (await started.json()) as { id?: string };
  if (!job.id) return null;

  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const poll = await fetch(`${VIDEO_URL}/${job.id}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!poll.ok) continue;
    const state = (await poll.json()) as {
      status?: string;
      progress?: number;
    };
    if (typeof state.progress === "number") {
      await onProgress(Math.max(1, Math.min(99, Math.round(state.progress))));
    }
    if (state.status === "completed") {
      const content = await fetch(`${VIDEO_URL}/${job.id}/content`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!content.ok) return null;
      return Buffer.from(await content.arrayBuffer());
    }
    if (state.status === "failed") return null;
  }
  return null;
}

export async function generateLiveMedia(token: string): Promise<void> {
  if (inflight.has(token)) return;
  const board = await liveBoardJob(token);
  if (!board) return;
  if (storageConfigured()) await ensureBucket();
  inflight.add(token);
  try {
    await fillKind(board.token, board.orderId, "image", board.title, board.category);
    await fillKind(board.token, board.orderId, "video", board.title, board.category);
  } finally {
    inflight.delete(token);
  }
}

async function fillKind(
  token: string,
  orderId: string,
  kind: "image" | "video",
  title: string,
  category: string | null,
): Promise<void> {
  const claimed = await claimLiveMedia(token, kind);
  if (!claimed) return;

  const pulled = await pullVoiceMedia(orderId, kind);
  if (pulled) {
    await attachLiveMedia({
      token,
      kind,
      bytes: pulled.bytes,
      contentType: pulled.contentType,
    });
    return;
  }

  if (!openaiKey()) {
    await releaseLiveMedia(token, kind);
    return;
  }

  await recordLiveEvent({
    token,
    kind: kind === "image" ? "illustration" : "film",
    message:
      kind === "image" ? "Drawing how the job looks." : "Filming the job.",
  });

  const prompt = kind === "image" ? imagePrompt(title, category) : videoPrompt(title, category);
  const bytes =
    kind === "image"
      ? await generateImage(prompt)
      : await generateVideo(prompt, (progress) =>
          setLiveMediaProgress(token, "video", progress),
        );
  if (!bytes) {
    await markLiveMediaFailed(token, kind);
    await recordLiveEvent({
      token,
      kind: kind === "image" ? "illustration_failed" : "film_failed",
      message:
        kind === "image"
          ? "Could not draw the job picture."
          : "Could not film the job.",
    });
    return;
  }
  await attachLiveMedia({
    token,
    kind,
    bytes,
    contentType: kind === "image" ? "image/png" : "video/mp4",
    prompt,
  });
}
