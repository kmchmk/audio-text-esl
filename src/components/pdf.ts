"use client";

export type PdfLine = { character: string; text: string };

/** Words a teacher can blank out: letters only, at least 3 characters. */
export const tokenize = (text: string) => text.split(/(\s+)/);
export const blankable = (w: string) => /[A-Za-z]{3,}/.test(w.replace(/[^A-Za-z']/g, ""));

/** Default gap per line: the longest word (5+ letters) that isn't the first word. */
export function defaultBlanks(lines: PdfLine[]): Set<string> {
  const out = new Set<string>();
  lines.forEach((l, li) => {
    const words = tokenize(l.text);
    let best = -1;
    let bestLen = 4;
    words.forEach((w, wi) => {
      const clean = w.replace(/[^A-Za-z']/g, "");
      if (wi > 0 && clean.length > bestLen && blankable(w)) {
        best = wi;
        bestLen = clean.length;
      }
    });
    if (best >= 0) out.add(`${li}:${best}`);
  });
  return out;
}

async function doc() {
  const { jsPDF } = await import("jspdf");
  return new jsPDF({ unit: "pt", format: "a4" });
}

function writer(pdf: Awaited<ReturnType<typeof doc>>) {
  const margin = 56;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = margin;
  const ensure = (h: number) => {
    if (y + h > pdf.internal.pageSize.getHeight() - margin) {
      pdf.addPage();
      y = margin;
    }
  };
  return {
    heading(text: string, size = 18) {
      pdf.setFont("helvetica", "bold").setFontSize(size);
      ensure(size + 8);
      pdf.text(text, margin, y + size);
      y += size + 12;
    },
    para(text: string, opts: { size?: number; bold?: string; gap?: number; color?: number } = {}) {
      const size = opts.size ?? 11.5;
      pdf.setFontSize(size).setTextColor(opts.color ?? 0);
      const prefix = opts.bold ? `${opts.bold}: ` : "";
      const lines = pdf.splitTextToSize(prefix + text, width) as string[];
      ensure(lines.length * size * 1.45);
      lines.forEach((ln, i) => {
        if (i === 0 && opts.bold) {
          pdf.setFont("helvetica", "bold").text(prefix, margin, y + size);
          pdf.setFont("helvetica", "normal").text(ln.slice(prefix.length), margin + pdf.getTextWidth(prefix), y + size);
        } else pdf.setFont("helvetica", "normal").text(ln, margin, y + size);
        y += size * 1.45;
      });
      y += opts.gap ?? 6;
      pdf.setTextColor(0);
    },
    space(h: number) {
      y += h;
    },
    newPage() {
      pdf.addPage();
      y = margin;
    },
  };
}

const filename = (title: string, suffix: string) =>
  `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "conversation"}-${suffix}.pdf`;

/** Plain conversation script. */
export async function conversationPdf(title: string, lines: PdfLine[]) {
  const pdf = await doc();
  const w = writer(pdf);
  w.heading(title);
  const speakers = [...new Set(lines.map((l) => l.character))];
  w.para(`Speakers: ${speakers.join(", ")}`, { size: 10, color: 100, gap: 14 });
  lines.forEach((l) => w.para(l.text, { bold: l.character }));
  pdf.save(filename(title, "script"));
}

/** Gap-fill listening worksheet with an answer key on the last page. */
export async function worksheetPdf(title: string, lines: PdfLine[], blanks: Set<string>) {
  const pdf = await doc();
  const w = writer(pdf);
  w.heading(title);
  w.para("Name: ______________________     Date: ____________", { size: 10, gap: 10 });
  w.para("Listen to the conversation and write the missing words.", { size: 11, gap: 14 });
  const answers: string[] = [];
  lines.forEach((l, li) => {
    const words = tokenize(l.text).map((word, wi) => {
      if (!blanks.has(`${li}:${wi}`)) return word;
      const core = word.match(/[A-Za-z'’-]+/)?.[0] ?? word;
      answers.push(core);
      return word.replace(core, `(${answers.length}) ________`);
    });
    w.para(words.join(""), { bold: l.character, gap: 9 });
  });
  w.newPage();
  w.heading("Answer key", 15);
  answers.forEach((a, i) => w.para(`${i + 1}. ${a}`, { size: 11, gap: 2 }));
  w.space(14);
  w.heading("Full transcript", 13);
  lines.forEach((l) => w.para(l.text, { bold: l.character, size: 10 }));
  pdf.save(filename(title, "worksheet"));
}
