import { getObjectStream, verifyAudioUrl } from "@/lib/storage";

/** Largest slice sent for one playback range request. Players fetch the rest in further ranges. */
const MAX_CHUNK = 4 * 1024 * 1024;

/**
 * Serves stored audio from the app's own domain. Access is by signed, expiring link (see
 * signedUrl), so share pages work without signing in. Supports HTTP range requests, which
 * audio players (especially Safari) use for streaming and seeking.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ok = verifyAudioUrl(url.searchParams);
  if (!ok) return new Response("Link expired or invalid. Reload the page.", { status: 403 });

  let range = req.headers.get("range") ?? undefined;
  if (range && !ok.dl) {
    // Cap open-ended or very large ranges so each response stays small.
    const m = range.match(/^bytes=(\d+)-(\d*)$/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), start + MAX_CHUNK - 1) : start + MAX_CHUNK - 1;
      range = `bytes=${start}-${end}`;
    }
  }

  let obj;
  try {
    obj = await getObjectStream(ok.key, ok.dl ? undefined : range);
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 416) return new Response(null, { status: 416 });
    if (status === 404) return new Response("Not found", { status: 404 });
    throw e;
  }

  const headers = new Headers({
    "Content-Type": obj.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  if (ok.dl) headers.set("Content-Disposition", `attachment; filename="${ok.dl}"`);
  if (obj.contentRange && range && !ok.dl) {
    headers.set("Content-Range", obj.contentRange);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}
