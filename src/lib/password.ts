import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 10;

/** Returns 0–4 strength score. */
export function passwordScore(pw: string): number {
  if (pw.length < MIN_PASSWORD_LENGTH) return 0;
  let s = 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`)
  .max(128, "Too long")
  .refine((pw) => passwordScore(pw) >= 3, "Mix upper/lowercase, numbers or symbols");

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "3–24 letters, numbers or _");

export const signupSchema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  username: usernameSchema,
  password: passwordSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "Display name required")
    .max(40, "Max 40 characters")
    .optional(),
});
