/** The fixed emotion list teachers pick from, shared by client and server. */
export const EMOTIONS = [
  { id: "neutral", label: "Neutral" },
  { id: "friendly", label: "Friendly" },
  { id: "cheerful", label: "Cheerful" },
  { id: "excited", label: "Excited" },
  { id: "sad", label: "Sad" },
  { id: "angry", label: "Angry" },
  { id: "serious", label: "Serious" },
  { id: "whispering", label: "Whispering" },
  { id: "surprised", label: "Surprised" },
  { id: "worried", label: "Worried" },
] as const;

export type Emotion = (typeof EMOTIONS)[number]["id"];

export const isEmotion = (v: string): v is Emotion => EMOTIONS.some((e) => e.id === v);

export const SPEED_MIN = 0.6;
export const SPEED_MAX = 1.6;
