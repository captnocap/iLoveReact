import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "fs-watch-rebuild",
  title: "Watch & rebuild",
  instructions:
    "Re-queue the worker whenever a watched source file changes. " +
    "Replace the path suffix with whatever you are iterating on.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Filesystem watch is the rawest form of feedback loop — a file " +
        "saves, the worker re-runs. Most useful when iterating on a " +
        "tight inner loop where you trust the worker to do the right " +
        "thing on each save without prompting.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: fs:changed:src/index.ts",
        "Action:  queue-job:rebuild",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Edit the file path in the trigger to whatever you are working " +
        "on. Pair with a debounce upstream if the watcher fires too " +
        "aggressively during multi-file saves.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('fs:changed:src/index.ts', 'queue-job:rebuild');\n`,
  },
};
