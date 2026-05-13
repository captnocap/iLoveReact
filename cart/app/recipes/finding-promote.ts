import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "finding-promote",
  title: "Promote finding",
  instructions:
    "When research promotes a finding, queue a follow-up job for the " +
    "worker to refine it.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Research workers emit promotion events when a finding crosses " +
        "the confidence bar. Acting on that immediately keeps the chain " +
        "of investigation alive without idle gaps.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: event:research.finding-promoted",
        "Action:  queue-job:promote",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind on any research task where promotion-driven follow-up is " +
        "wanted. The downstream Job row carries the original finding's " +
        "context, so the worker picks up where it left off.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('event:research.finding-promoted', 'queue-job:promote');\n`,
  },
};
