/**
 * @owner Will
 * Stable ID generators: usr_ / tsk_ / ofr_
 */
import { nanoid } from "nanoid";

export function newUserId(): string {
  return `usr_${nanoid(10)}`;
}

export function newTaskId(): string {
  return `tsk_${nanoid(10)}`;
}

export function newOfferId(): string {
  return `ofr_${nanoid(10)}`;
}
