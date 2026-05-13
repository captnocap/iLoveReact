import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "budget-warn",
  title: "Budget warn",
  instructions:
    "Notify the user the moment the budget threshold trips. Pair with a " +
    "downstream pause rule if the user does not acknowledge.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Budget overruns rarely fire at the limit — they fire on the " +
        "warned-threshold event before the limit, so the user has " +
        "headroom to act. This recipe surfaces that warning the instant " +
        "it lands.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: event:budget.threshold-warned",
        "Action:  notify-user:Budget threshold hit",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally for any run that talks to a paid model. Stack " +
        "with a halt-on-budget-exceeded rule for the hard ceiling.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('event:budget.threshold-warned', 'notify-user:Budget threshold hit');\n`,
  },
};
