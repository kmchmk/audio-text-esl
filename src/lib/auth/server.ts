import "server-only";

import { createNeonAuth } from "@neon/auth/next/server";
import { redirect } from "next/navigation";
import { cache } from "react";

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

/**
 * The signed-in teacher with their starter content created. Cached per request, so the
 * layout and page (which Next renders in parallel) share one seeding pass.
 */
export const getSeededUser = cache(async (): Promise<AppUser | null> => {
  const user = await getUser();
  if (user) {
    const { ensureSeeded } = await import("../data");
    await ensureSeeded(user.id);
  }
  return user;
});

/** For pages: the seeded teacher, or a redirect to sign-in. */
export async function requireSeededUser(): Promise<AppUser> {
  const user = await getSeededUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}
