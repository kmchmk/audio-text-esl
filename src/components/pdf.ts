"use client";

import { buildScriptPdf, buildWorksheetPdf, pdfFilename, type PdfLine } from "@/lib/pdf/core";

export { blankable, defaultBlanks, isMonologue, tokenize, type PdfLine } from "@/lib/pdf/core";

/** Download the plain script PDF. */
export async function conversationPdf(title: string, lines: PdfLine[]) {
  (await buildScriptPdf(title, lines)).save(pdfFilename(title, "script"));
}

/** Download the gap-fill worksheet PDF. */
export async function worksheetPdf(title: string, lines: PdfLine[], blanks: Set<string>) {
  (await buildWorksheetPdf(title, lines, blanks)).save(pdfFilename(title, "worksheet"));
}
