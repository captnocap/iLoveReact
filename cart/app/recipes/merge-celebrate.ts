import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "merge-celebrate",
  title: "Merge celebrate",
  instructions:
    "On a merged workstream, consolidate memory so the worker does not " +
    "re-discover what just landed.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A workstream merge is a checkpoint — what was uncertain is now " +
        "fixed. commit-state collapses the working memory into a stable " +
        "baseline so subsequent turns start from the merged truth, not " +
        "the pre-merge speculation.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: event:workstream.merged",
        "Action:  commit-state",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on any long-running run where multiple " +
        "workstreams converge. Prevents context bloat from carrying " +
        "now-resolved alternatives forward turn after turn.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('event:workstream.merged', 'commit-state');\n`,
  },
};
