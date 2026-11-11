import type { Emotion } from "./emotions";

/** Starter characters every new teacher gets (free Supertonic voices). */
export const TEMPLATE_CHARACTERS = [
  { key: "dad", name: "Dad", gender: "male", age_group: "adult", accent: "American", voice: "M1" },
  { key: "mom", name: "Mom", gender: "female", age_group: "adult", accent: "American", voice: "F1" },
  { key: "son", name: "Son", gender: "male", age_group: "teen", accent: "American", voice: "M3" },
  { key: "daughter", name: "Daughter", gender: "female", age_group: "teen", accent: "American", voice: "F3" },
] as const;

type Key = (typeof TEMPLATE_CHARACTERS)[number]["key"];

export const TEMPLATE_TITLE = "Family dinner";

export const TEMPLATE_LINES: { who: Key; text: string; emotion: Emotion }[] = [
  { who: "mom", text: "Dinner's ready, everyone! Come and sit down before it gets cold.", emotion: "cheerful" },
  { who: "son", text: "Coming! Wow, it smells amazing. Is that lasagna?", emotion: "excited" },
  { who: "mom", text: "It is. I tried a new recipe with spinach and three kinds of cheese.", emotion: "friendly" },
  { who: "dad", text: "Mmm, this is delicious, honey. Could you pass the salad, please?", emotion: "friendly" },
  { who: "daughter", text: "Here you go, Dad. Oh, guess what happened at school today?", emotion: "excited" },
  { who: "dad", text: "Tell us! Did you finally get your science project back?", emotion: "cheerful" },
  { who: "daughter", text: "Yes! I got an A, and Mrs. Carter wants to put it in the school exhibition!", emotion: "excited" },
  { who: "mom", text: "That's wonderful, sweetheart! I'm so proud of you.", emotion: "cheerful" },
  { who: "son", text: "Well, I have news too. Our team won the basketball game this afternoon.", emotion: "cheerful" },
  { who: "dad", text: "Really? That's fantastic! Did you score any points?", emotion: "surprised" },
  { who: "son", text: "Twelve points. But I twisted my ankle a little at the end.", emotion: "neutral" },
  { who: "mom", text: "Oh no! Does it hurt? Let me put some ice on it after dinner.", emotion: "worried" },
  { who: "son", text: "It's fine, Mom, honestly. Can I have another piece of lasagna?", emotion: "neutral" },
  { who: "daughter", text: "Hey, save some for me! You always take the biggest piece.", emotion: "angry" },
  { who: "dad", text: "Okay, okay, there's plenty for everyone. Who wants dessert later?", emotion: "friendly" },
  { who: "mom", text: "There's chocolate ice cream in the freezer, but only after you both finish your vegetables!", emotion: "serious" },
];

/** Size of the template, used to estimate and filter model prices. */
export const TEMPLATE_STATS = {
  chars: TEMPLATE_LINES.reduce((n, l) => n + l.text.length, 0), // 995
  seconds: 80,
};
