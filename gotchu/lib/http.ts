/**
 * @owner Will
 * Frozen API envelope: { ok: true, data } | { ok: false, error }
 */
import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
