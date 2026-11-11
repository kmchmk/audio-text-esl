// Renders the script and worksheet PDFs for a monologue and a conversation into <out-dir>.
// jsPDF's save() writes to the current directory when run under Node.
import { conversationPdf, defaultBlanks, worksheetPdf } from "../src/components/pdf.ts";

process.chdir(process.argv[2]);
const mono = [
  { character: "Guide", text: "Good morning, everyone, and welcome to the city museum." },
  { character: "Guide", text: "Our tour starts in the main hall, where you can see the old steam train." },
  { character: "Guide", text: "Please stay with the group and keep your tickets with you at all times." },
];
const conv = [
  { character: "Mom", text: "Dinner's ready, everyone! Come and sit down before it gets cold." },
  { character: "Son", text: "Coming! Wow, it smells amazing. Is that lasagna?" },
];
await conversationPdf("Museum tour", mono);
await worksheetPdf("Museum tour", mono, defaultBlanks(mono));
await conversationPdf("Family dinner", conv);
console.log("done");
