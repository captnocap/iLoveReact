import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "apology-loop",
  title: "Apology without behavioral change",
  instructions:
    "Three apologies in a row without an intervening behavior delta. " +
    'Catches the "sorry → restate same plan" loop.',
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A worker that apologizes repeatedly without the underlying " +
        "behavior changing is registering the user's correction at the " +
        "tone layer but not the action layer. Three apologies in a row " +
        "is a strong signal the loop has flipped into performative mode.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: repeat:claude:text::(sorry|my mistake|apologies):3",
        "Action:  flag-pathology:apology_without_change",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim. Until " +
        "that lands the repeat: trigger has no input to count against.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on conversational runs. Combine with " +
        "inject-message so the supervisor can break the loop by demanding " +
        "an explicit behavior change rather than another apology.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('repeat:claude:text::(sorry|my mistake|apologies):3', 'flag-pathology:apology_without_change');\n`,
  },
};
