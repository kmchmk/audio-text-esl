"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { isEmailAllowed } from "@/lib/env";

export type FormState = { error?: string; message?: string } | null;

const NOT_ALLOWED =
  "This email isn't on the list of allowed teachers. Ask the administrator to add it.";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (!isEmailAllowed(email)) return { error: NOT_ALLOWED };
  if (password.length < 8) return { error: "Use at least 8 characters for the password." };
  const { error } = await getAuth().signUp.email({ email, password, name: str(form, "name") || email });
  if (error) return { error: error.message || "Couldn't create the account." };
  redirect("/");
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  if (!isEmailAllowed(email)) return { error: NOT_ALLOWED };
  const { error } = await getAuth().signIn.email({ email, password: str(form, "password") });
  if (error) return { error: error.message || "Wrong email or password." };
  redirect("/");
}

export async function signOut() {
  await getAuth().signOut();
  redirect("/auth/sign-in");
}

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return process.env.APP_URL || `${proto}://${host}`;
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  // Same answer whether or not the account exists.
  if (isEmailAllowed(email)) {
    const { error } = await getAuth().requestPasswordReset({
      email,
      redirectTo: `${await origin()}/auth/reset-password`,
    });
    if (error) console.warn("[auth] requestPasswordReset", error.message);
  }
  return { message: "If that account exists, a reset link is on its way. Check your inbox." };
}

export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const token = str(form, "token");
  const newPassword = str(form, "password");
  if (!token) return { error: "The reset link is missing its token. Request a new one." };
  if (newPassword.length < 8) return { error: "Use at least 8 characters for the password." };
  const { error } = await getAuth().resetPassword({ token, newPassword });
  if (error) return { error: error.message || "Couldn't reset the password. The link may have expired." };
  redirect("/auth/sign-in?reset=1");
}
