import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "mount-log",
  title: "Boot log",
  instructions:
    "Drop a marker the moment the cart mounts. Useful as a sanity check " +
    "for whether a recipe is actually running.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "The mount source fires exactly once per cart lifecycle. " +
        "Pairing it with log: gives you a dated entry every time the " +
        "cart starts — the cheapest possible 'is anything wired up' check.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: mount",
        "Action:  log:cart-ready",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Drop in when bootstrapping a new recipe set and you want " +
        "evidence the IFTTT graph is alive before adding real rules. " +
        "Remove or repurpose once you trust the wiring.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('mount', 'log:cart-ready');\n`,
  },
};
