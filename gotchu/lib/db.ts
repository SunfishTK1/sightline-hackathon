/**
 * @owner Will
 * Typed collection accessors.
 */
import type { Collection } from "mongodb";
import { getDb } from "./mongo";
import type { User } from "./types/user";
import type { Task } from "./types/task";
import type { Offer } from "./types/offer";
import type { Agreement } from "./types/agreement";
import type { Review } from "./types/review";

export async function users(): Promise<Collection<User>> {
  return (await getDb()).collection<User>("users");
}

export async function tasks(): Promise<Collection<Task>> {
  return (await getDb()).collection<Task>("tasks");
}

export async function offers(): Promise<Collection<Offer>> {
  return (await getDb()).collection<Offer>("offers");
}

export async function agreements(): Promise<Collection<Agreement>> {
  return (await getDb()).collection<Agreement>("agreements");
}

export async function reviews(): Promise<Collection<Review>> {
  return (await getDb()).collection<Review>("reviews");
}
