import { verifyPdfUrl, versionLines } from "@/lib/agent/pdf";
import { buildScriptPdf, buildWorksheetPdf, defaultBlanks, pdfFilename } from "@/lib/pdf/core";

/** Signed PDF download (script or worksheet) for one generated version. Used by agents. */
export async function GET(req: Request) {
  const ok = verifyPdfUrl(new URL(req.url).searchParams);
  if (!ok) return new Response("Link expired or invalid.", { status: 403 });
  const v = await versionLines(ok.generationId);
  if (!v) return new Response("Not found", { status: 404 });
  let pdf;
  if (ok.kind === "script") pdf = await buildScriptPdf(v.title, v.lines);
  else {
    const blanks = ok.gaps === "auto" ? defaultBlanks(v.lines) : new Set(ok.gaps.split(",").filter(Boolean));
    pdf = await buildWorksheetPdf(v.title, v.lines, blanks);
  }
  return new Response(pdf.output("arraybuffer"), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFilename(v.title, ok.kind)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
