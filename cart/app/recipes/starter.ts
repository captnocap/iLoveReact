import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "starter",
  title: "Starter",
  instructions:
    "Empty scaffold — a single commented useIFTTT line you fill in. " +
    "Use this when you want the function shell without a pattern attached.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A blank Recipe() shell with one commented useIFTTT line. " +
        "Loading this recipe drops zero live nodes on the canvas; the " +
        "code editor opens with the comment as a hint for where to type.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Pick this when you know what trigger and action you want but " +
        "none of the curated recipes are close enough to start from. " +
        "Type the spec directly, save, and the canvas picks up the rule.",
    },
  ],
  scaffold: {
    body: `  // useIFTTT('your-trigger', 'your-action');\n`,
  },
};
