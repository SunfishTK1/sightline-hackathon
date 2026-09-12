/**
 * @owner Will
 * Shared onboarding / profile validation. Used by the form and the API.
 */
import { z } from "zod";
import { isE164, toE164 } from "./phone";

/** Auth0 Post-Login Action + product rule: verified CMU student email. */
export const CMU_EMAIL = /@(andrew\.)?cmu\.edu$/i;

export function isCmuEmail(email: string): boolean {
  return CMU_EMAIL.test(email.trim().toLowerCase());
}

export function normalizeCmuEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Client-side resize keeps real uploads well under this; server enforces it too. */
export const MAX_PHOTO_DATA_URL_LENGTH = 900_000;
const PHOTO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/;

const photoDataUrlSchema = z
  .string()
  .refine((value) => PHOTO_DATA_URL.test(value), "Photo must be a JPEG, PNG, or WEBP image")
  .refine((value) => value.length <= MAX_PHOTO_DATA_URL_LENGTH, "Photo is too large — try a smaller image");

export const onboardingSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(40),
  lastName: z.string().trim().min(1, "Last name is required").max(40),
  phone: z
    .string()
    .trim()
    .min(1, "Phone is required")
    .transform((value, ctx) => {
      const e164 = toE164(value);
      if (!e164 || !isE164(e164)) {
        ctx.addIssue({
          code: "custom",
          message: "Use an E.164 number, like +1 (412) 555-0123",
        });
        return z.NEVER;
      }
      return e164;
    }),
  cmuEmail: z
    .string()
    .trim()
    .min(1, "CMU email is required")
    .transform((value, ctx) => {
      const email = normalizeCmuEmail(value);
      if (!isCmuEmail(email)) {
        ctx.addIssue({
          code: "custom",
          message: "Must be a verified CMU address ending in @andrew.cmu.edu",
        });
        return z.NEVER;
      }
      return email;
    }),
  acceptedTerms: z
    .boolean()
    .refine((value) => value, "You must read and agree to the Terms of Service"),
  ageConfirmed: z
    .boolean()
    .refine((value) => value, "You must confirm you are 18 or older"),
  consentCall: z
    .boolean()
    .refine((value) => value, "You must opt in to being called"),
  consentText: z
    .boolean()
    .refine((value) => value, "You must opt in to being texted"),
  // Deliberately not refined: this one is allowed to be false.
  consentLikeness: z.boolean().optional().default(false),
  photoDataUrl: photoDataUrlSchema.optional(),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingParsed = z.output<typeof onboardingSchema>;

export const profilePatchSchema = z
  .object({
    firstName: z.string().trim().min(1).max(40).optional(),
    lastName: z.string().trim().min(1).max(40).optional(),
    phone: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const e164 = toE164(value);
        if (!e164) {
          ctx.addIssue({
            code: "custom",
            message: "Use an E.164 number, like +1 (412) 555-0123",
          });
          return z.NEVER;
        }
        return e164;
      })
      .optional(),
    preferenceText: z.string().trim().min(20).max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const availabilitySchema = z.object({
  isAvailable: z.boolean(),
  until: z.string().datetime().optional(),
});
