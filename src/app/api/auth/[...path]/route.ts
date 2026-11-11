import { getAuth } from "@/lib/auth/server";

type Handler = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
let handlers: ReturnType<ReturnType<typeof getAuth>["handler"]> | undefined;
const h = () => (handlers ??= getAuth().handler());

const forward =
  (m: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"): Handler =>
  (req, ctx) =>
    (h()[m] as Handler)(req, ctx);

export const GET = forward("GET");
export const POST = forward("POST");
export const PUT = forward("PUT");
export const PATCH = forward("PATCH");
export const DELETE = forward("DELETE");
