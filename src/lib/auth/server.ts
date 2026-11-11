import "server-only";

import { createNeonAuth } from "@neon/auth/next/server";

import { env, isEmailAllowed } from "../env";

let auth: ReturnType<typeof createNeonAuth> | undefined;

/** Lazy: createNeonAuth checks the cookie secret when constructed. */
export function getAuth() {
  return (auth ??= createNeonAuth({
    baseUrl: env().authBaseUrl,
    cookies: { secret: env().authCookieSecret },
  }));
}

export type AppUser = { id: string; email: string; name: string };

/**
 * The signed-in teacher, or null. Users whose email is no longer in ALLOWED_EMAILS
 * count as signed out. Call this in every server data path: proxy.ts is only UX.
 */
export async function getUser(): Promise<AppUser | null> {
  const { data, error } = await getAuth().getSession();
  if (error) console.warn("[auth] getSession failed", error.code);
  const u = data?.user;
  if (!u || !isEmailAllowed(u.email)) return null;
  return { id: u.id, email: u.email, name: u.name || u.email };
}

/** For route handlers: the user or a 401 response. */
export async function requireUser(): Promise<AppUser | Response> {
  const user = await getUser();
  return user ?? Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
}
