import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "pathology-halt",
  title: "Pathology halt",
  instructions:
    "When the supervisor flags a pathology, stop the run dead in its " +
    "tracks. Use as a safety floor for any worker that can produce " +
    "harmful output.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A pathology flag is the supervisor's most severe verdict — it " +
        "means a known-harmful pattern just fired. The right reaction is " +
        "almost always to halt the run before more harm can land, then " +
        "surface to the user.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: event:pathology.detected",
        "Action:  halt-run",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind to the Global row of the sequencer for any run with a " +
        "non-trivial pathology catalog. Combine with notify-user or " +
        "kick-to-supervisor on a sibling rule if you want the halt to " +
        "also page someone.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('event:pathology.detected', 'halt-run');\n`,
  },
};
