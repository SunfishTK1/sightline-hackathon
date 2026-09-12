/**
 * @owner Will
 * Profile photo upload. Resized client-side to a small square JPEG and
 * sent as a data: URI — no object storage needed for the hackathon.
 *
 * Why we collect it: it is the reference the illustrator is conditioned on, so
 * the picture drawn for a task can actually look like the person in it.
 * Pictures only — video generation was removed, so the copy below must not
 * promise an animation we never make. Optional; nothing here is public.
 */
"use client";

import { useRef, useState } from "react";
import { Label } from "@/components/ui/label";

const MAX_DIMENSION = 512;
const JPEG_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 15_000_000;

async function resizeImageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function PhotoField({
  value,
  onChange,
  error,
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setLocalError(null);

    if (!file.type.startsWith("image/")) {
      setLocalError("That doesn't look like an image file.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setLocalError("That image is too large — try one under 15MB.");
      return;
    }

    setProcessing(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      onChange(dataUrl);
    } catch {
      setLocalError("Could not read that image — try a different file.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="photo">Photo</Label>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label={value ? "Change photo" : "Upload a photo"}
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white text-xs text-muted-foreground"
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-cover" />
          ) : processing ? (
            "…"
          ) : (
            "Add"
          )}
        </button>

        <div className="flex flex-col items-start gap-1">
          <input
            ref={inputRef}
            id="photo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-sm font-medium text-[var(--broker)] underline-offset-2 hover:underline"
          >
            {value ? "Change photo" : "Upload a photo"}
          </button>
          {value ? (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional. We use it so the picture drawn for a task can look like
        you — either doing the task, or having it done for you. Nothing here
        is shown publicly.
      </p>
      {localError ?? error ? (
        <p className="text-sm text-destructive">{localError ?? error}</p>
      ) : null}
    </div>
  );
}
