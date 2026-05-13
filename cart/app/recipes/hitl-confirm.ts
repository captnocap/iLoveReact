import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "hitl-confirm",
  title: "Human-in-the-loop confirm",
  instructions:
    "Before the worker commits a state change, route through HITL so " +
    "the user signs off. Worker pauses until acknowledged.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Some commits are too irreversible to let the worker make on " +
        "its own. The hitl action stops the run and yields the floor " +
        "to the user; only an explicit acknowledgment resumes it.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: event:state.about-to-commit",
        "Action:  hitl",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind on tasks that produce one-shot, hard-to-rollback writes " +
        "(payments, broadcasts, destructive deletes). The cost of the " +
        "pause is small compared to the cost of an unwanted commit.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('event:state.about-to-commit', 'hitl');\n`,
  },
};
