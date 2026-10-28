import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/campusbid"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters").default("development-only-change-this-session-secret"),
  EMAIL_PROVIDER: z.enum(["development", "smtp"]).default("development"),
  EMAIL_FROM: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  IMAGE_STORAGE_PROVIDER: z.enum(["local", "cloudinary"]).default("local"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  AUCTION_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(5000).default(5000)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${fields}`);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.SESSION_SECRET.startsWith("development-only")) {
  throw new Error("SESSION_SECRET must be replaced with a securely generated value in production.");
}
if (parsed.data.NODE_ENV === "production" && parsed.data.SESSION_SECRET.startsWith("replace-with-")) {
  throw new Error("SESSION_SECRET must be replaced with a securely generated value in production.");
}
if (parsed.data.NODE_ENV === "production" && /localhost|127\.0\.0\.1/.test(parsed.data.MONGODB_URI)) {
  throw new Error("MONGODB_URI must reference a reachable production database.");
}
if (parsed.data.NODE_ENV === "production" && parsed.data.COOKIE_SECURE !== "true") {
  throw new Error("COOKIE_SECURE=true is required in production.");
}
if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_PROVIDER !== "smtp") {
  throw new Error("EMAIL_PROVIDER=smtp is required in production to verify student email addresses.");
}
if (parsed.data.NODE_ENV === "production" && (!parsed.data.EMAIL_FROM || !parsed.data.SMTP_HOST || !parsed.data.SMTP_USER || !parsed.data.SMTP_PASSWORD)) {
  throw new Error("EMAIL_FROM, SMTP_HOST, SMTP_USER, and SMTP_PASSWORD must be configured for production email.");
}
if (parsed.data.NODE_ENV === "production" && parsed.data.IMAGE_STORAGE_PROVIDER !== "cloudinary") {
  throw new Error("IMAGE_STORAGE_PROVIDER=cloudinary is required in production for persistent item photos.");
}
if (parsed.data.IMAGE_STORAGE_PROVIDER === "cloudinary" && (!parsed.data.CLOUDINARY_CLOUD_NAME || !parsed.data.CLOUDINARY_API_KEY || !parsed.data.CLOUDINARY_API_SECRET)) {
  throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required when Cloudinary image storage is enabled.");
}

export const config = {
  ...parsed.data,
  secureCookie: parsed.data.COOKIE_SECURE === "true"
};
