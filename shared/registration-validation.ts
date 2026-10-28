import { z } from "zod";

export const konguEmailError = "Please use a valid Kongu college email ending in @kongu.edu.";
export const registrationPasswordError = "Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character. Spaces are not allowed.";
export const invalidEmailError = "Enter a valid email address.";

export const konguEmailSchema = z
  .string()
  .trim()
  .min(1, konguEmailError)
  .max(254, konguEmailError)
  .email(konguEmailError)
  .transform((email) => email.toLowerCase())
  .refine((email) => email.endsWith("@kongu.edu"), konguEmailError);

export const normalizedEmailSchema = z
  .string()
  .trim()
  .min(1, invalidEmailError)
  .max(254, invalidEmailError)
  .email(invalidEmailError)
  .transform((email) => email.toLowerCase());

export const registrationPasswordSchema = z.string().max(128, registrationPasswordError).superRefine((password, context) => {
  const valid = password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9\s]/.test(password)
    && !/\s/.test(password);

  if (!valid) context.addIssue({ code: "custom", message: registrationPasswordError });
});
