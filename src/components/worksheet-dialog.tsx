"use client";

import { useState } from "react";

import { blankable, defaultBlanks, tokenize, worksheetPdf, type PdfLine } from "./pdf";

/** Pick the words to blank out (click to toggle), then download the worksheet PDF. */
export function WorksheetDialog({ title, lines, onClose }: { title: string; lines: PdfLine[]; onClose: () => void }) {
  const [blanks, setBlanks] = useState(() => defaultBlanks(lines));
  const toggle = (k: string) =>
    setBlanks((b) => {
      const n = new Set(b);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center sm:px-4" role="dialog" aria-modal>
      <div className="card flex max-h-[90dvh] w-full max-w-2xl flex-col p-4 shadow-xl sm:p-5">
        <h2 className="text-lg font-semibold">Gap-fill worksheet</h2>
        <p className="text-sm text-muted">Tap words to add or remove gaps. {blanks.size} gaps selected.</p>
        <ol className="my-4 flex-1 space-y-2 overflow-y-auto text-sm">
          {lines.map((l, li) => (
            <li key={li}>
              <span className="font-medium">{l.character}: </span>
              {tokenize(l.text).map((w, wi) =>
                blankable(w) ? (
                  <button
                    key={wi}
                    onClick={() => toggle(`${li}:${wi}`)}
                    className={`rounded px-0.5 py-0.5 ${blanks.has(`${li}:${wi}`) ? "bg-accent text-white" : "hover:bg-accent-soft"}`}
                  >
                    {w}
                  </button>
                ) : (
                  <span key={wi}>{w}</span>
                ),
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => setBlanks(new Set())}>
            Clear gaps
          </button>
          <button className="btn" onClick={() => setBlanks(defaultBlanks(lines))}>
            Suggest gaps
          </button>
          <div className="ml-auto flex gap-2">
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-primary" onClick={() => worksheetPdf(title, lines, blanks).then(onClose)}>
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
