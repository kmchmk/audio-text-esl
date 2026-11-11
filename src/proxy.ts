import type { NextRequest } from "next/server";

import { getAuth } from "./lib/auth/server";

let middleware: ReturnType<ReturnType<typeof getAuth>["middleware"]> | undefined;

/** Redirect signed-out page loads to sign-in. Every data path re-checks with getUser(). */
export default function proxy(request: NextRequest) {
  if (request.headers.has("next-action")) return;
  middleware ??= getAuth().middleware({ loginUrl: "/auth/sign-in" });
  return middleware(request);
}

// App pages only. /auth/*, /s/* (public share links) and /api/* handle auth themselves.
export const config = { matcher: ["/", "/conversations/:path*", "/characters/:path*"] };
