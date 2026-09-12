/**
 * Object storage for generated media.
 *
 * Videos were being kept as `bytea` in Postgres and shipped base64 through
 * JSON, which is what forced voice-mcp's 25MB body limit: a sixteen-second
 * clip is around nine megabytes, and base64 makes it twelve. The bytes belong
 * in a bucket, and the database should hold nothing but the key.
 *
 * This talks to MinIO over the private network, so nothing here is reachable
 * from outside Railway. Every function returns null rather than throwing - a
 * storage outage must not stop a clip being generated or a text being sent.
 */
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

const ENDPOINT = process.env.S3_ENDPOINT || "";
const BUCKET = process.env.S3_BUCKET || "gotchu-media";
const ACCESS_KEY = process.env.S3_ACCESS_KEY || "";
const SECRET_KEY = process.env.S3_SECRET_KEY || "";

export const storageConfigured = (): boolean =>
  Boolean(ENDPOINT && ACCESS_KEY && SECRET_KEY);

let client: S3Client | null = null;

function s3(): S3Client {
  // MinIO has no DNS-style bucket hosts, so addressing has to be path style.
  client ??= new S3Client({
    endpoint: ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  return client;
}

/** Make the bucket on boot, the way the schema is migrated on boot. */
export async function ensureBucket(): Promise<boolean> {
  if (!storageConfigured()) return false;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: BUCKET }));
    return true;
  } catch {
    try {
      await s3().send(new CreateBucketCommand({ Bucket: BUCKET }));
      return true;
    } catch (err) {
      console.error(`could not create the ${BUCKET} bucket:`, (err as Error).message);
      return false;
    }
  }
}

export function videoKey(orderId: string): string {
  return `videos/${orderId}.mp4`;
}

/** Store the clip. Returns the key to record, or null if it could not be put. */
export async function putVideo(orderId: string, mp4: Buffer): Promise<string | null> {
  if (!storageConfigured()) return null;
  const Key = videoKey(orderId);
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        Body: mp4,
        ContentType: "video/mp4",
      }),
    );
    return Key;
  } catch (err) {
    console.error(`could not store ${Key}:`, (err as Error).message);
    return null;
  }
}

/** Read a clip back for delivery. */
export async function getVideo(key: string): Promise<Buffer | null> {
  if (!storageConfigured()) return null;
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = res.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (err) {
    console.error(`could not read ${key}:`, (err as Error).message);
    return null;
  }
}
