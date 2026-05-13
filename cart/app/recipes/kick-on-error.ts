import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "kick-on-error",
  title: "Kick on error",
  instructions:
    "Any run-level error gets pushed to the supervisor on duty as a " +
    "notification, with the trigger context attached.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Run errors usually mean the worker hit something it can't " +
        "recover from on its own. kick-to-supervisor escalates without " +
        "halting — the run keeps running while a human gets a heads up " +
        "and can intervene.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: event:run.error",
        "Action:  kick-to-supervisor",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on any run worth supervising. Stack with halt-run " +
        "for the hard-stop version if the error class is fatal.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('event:run.error', 'kick-to-supervisor');\n`,
  },
};
