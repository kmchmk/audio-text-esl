"use client";

import { useState } from "react";

import { setTutorialDone } from "./actions";

const STEPS = [
  {
    title: "Welcome to ESL Listening Studio",
    body: "Write a conversation, choose who says each line, and turn it into audio for listening practice or tests. We made you a sample conversation, \"Family dinner\", to try first.",
  },
  {
    title: "1. Characters",
    body: "Characters are your speakers. Each one has a voice, accent, gender, age and default speed. You already have Dad, Mom, Son and Daughter. Free voices cost nothing; paid voices show their price in baht.",
  },
  {
    title: "2. Write the conversation",
    body: "Type one line per row. For each line pick the speaker, an emotion and a speed. Everything saves automatically, even offline, and appears on your other devices.",
  },
  {
    title: "3. Convert to audio",
    body: "Click \"Convert to audio\". Each conversion is saved as a new version (v1, v2…) in the history, with its cost. If you later change a character, older versions show what the voice was then.",
  },
  {
    title: "4. Listen, download and share",
    body: "Play with the transcript highlighted, add background noise for a realistic test, download the full MP3 or single lines, print a PDF or worksheet, or share a link students can open without signing in.",
  },
];

/** One-time walkthrough for new teachers. Re-open it any time from the header. */
export function Tutorial({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [step, setStep] = useState(0);
  const close = () => {
    setOpen(false);
    setStep(0);
    setTutorialDone(true).catch(() => {});
  };
  return (
    <>
      <button className="text-muted hover:text-fg" onClick={() => setOpen(true)}>
        Help
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal>
          <div className="card w-full max-w-md space-y-4 p-6 shadow-xl">
            <p className="text-xs text-muted">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="text-lg font-semibold">{STEPS[step].title}</h2>
            <p className="text-sm leading-relaxed">{STEPS[step].body}</p>
            <div className="flex items-center gap-2 pt-2">
              <button className="btn btn-ghost text-muted" onClick={close}>
                Skip
              </button>
              <div className="ml-auto flex gap-2">
                {step > 0 && (
                  <button className="btn" onClick={() => setStep(step - 1)}>
                    Back
                  </button>
                )}
                {step < STEPS.length - 1 ? (
                  <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
                    Next
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={close}>
                    Get started
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
