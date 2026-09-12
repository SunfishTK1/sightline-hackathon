import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

function endpoint(): string {
  return process.env.S3_ENDPOINT || "";
}

function bucket(): string {
  return process.env.S3_BUCKET || "gotchu-media";
}

function accessKey(): string {
  return process.env.S3_ACCESS_KEY || "";
}

function secretKey(): string {
  return process.env.S3_SECRET_KEY || "";
}

export const storageConfigured = (): boolean =>
  Boolean(endpoint() && accessKey() && secretKey());

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: endpoint(),
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: accessKey(), secretAccessKey: secretKey() },
  });
  return client;
}

export async function ensureBucket(): Promise<boolean> {
  if (!storageConfigured()) return false;
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket() }));
    return true;
  } catch {
    try {
      await s3().send(new CreateBucketCommand({ Bucket: bucket() }));
      return true;
    } catch (err) {
      console.error(`could not create the ${bucket()} bucket:`, (err as Error).message);
      return false;
    }
  }
}

export function imageKey(id: string): string {
  return `images/${id}.png`;
}

export function videoKey(id: string): string {
  return `videos/${id}.mp4`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string | null> {
  if (!storageConfigured()) return null;
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  } catch (err) {
    console.error(`could not store ${key}:`, (err as Error).message);
    return null;
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (!storageConfigured()) return null;
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
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
