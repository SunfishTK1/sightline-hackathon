/**
 * @owner Will
 * Cached MongoDB client (Next.js hot-reload safe).
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const options = {};

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | null = null;

if (uri) {
  if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
      const client = new MongoClient(uri, options);
      global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
  } else {
    const client = new MongoClient(uri, options);
    clientPromise = client.connect();
  }
}

export default clientPromise;

export async function getDb() {
  if (!clientPromise) {
    throw new Error("MONGODB_URI is not set");
  }
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB ?? "gotchu");
}
