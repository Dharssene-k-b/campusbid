import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/campusbid"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters").default("development-only-change-this-session-secret"),
  COLLEGE_EMAIL_DOMAINS: z.string().default(""),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  AUCTION_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(5000).default(30000)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${fields}`);
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.COLLEGE_EMAIL_DOMAINS.trim()) {
  throw new Error("COLLEGE_EMAIL_DOMAINS must be configured in production.");
}
if (parsed.data.NODE_ENV === "production" && parsed.data.SESSION_SECRET.startsWith("development-only")) {
  throw new Error("SESSION_SECRET must be replaced with a securely generated value in production.");
}

export const config = {
  ...parsed.data,
  allowedDomains: parsed.data.COLLEGE_EMAIL_DOMAINS.split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean),
  secureCookie: parsed.data.COOKIE_SECURE === "true"
};
