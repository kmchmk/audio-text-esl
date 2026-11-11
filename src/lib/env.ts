import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let cached: ReturnType<typeof load> | undefined;

function load() {
  return {
    databaseUrl: required("DATABASE_URL"),
    authBaseUrl: required("NEON_AUTH_BASE_URL"),
    authCookieSecret: required("NEON_AUTH_COOKIE_SECRET"),
    realtimeUrl: required("NEON_REALTIME_URL"),
    realtimeSecret: required("NEON_REALTIME_SECRET"),
    s3: {
      endpoint: required("AWS_ENDPOINT_URL_S3"),
      region: required("AWS_REGION"),
      accessKeyId: required("AWS_ACCESS_KEY_ID"),
      secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
      bucket: process.env.S3_BUCKET || "audio",
    },
    openrouterKey: process.env.OPENROUTER_API_KEY || "",
    openrouterManagementKey: process.env.OPENROUTER_MANAGEMENT_KEY || "",
    /** Signs internal worker calls; falls back to the cookie secret. */
    workerSecret: process.env.WORKER_SECRET || required("NEON_AUTH_COOKIE_SECRET"),
  };
}

/** Read and validate server environment on first use (not at import, so builds work). */
export function env() {
  return (cached ??= load());
}

/** Lower-cased allowlist from ALLOWED_EMAILS (comma separated). */
export function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  return !!email && allowedEmails().has(email.trim().toLowerCase());
}

/** Thai baht per US dollar. Hard-coded default (mid-market rate, 11 Nov 2026), overridable. */
export const DEFAULT_USD_THB_RATE = 33.5;
export function usdThbRate(): number {
  const v = Number(process.env.USD_THB_RATE);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_THB_RATE;
}
