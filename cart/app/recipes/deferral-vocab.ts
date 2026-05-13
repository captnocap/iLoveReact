import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "deferral-vocab",
  title: "Deferral vocabulary",
  instructions:
    '"We can revisit X in a focused session" / "let us not boil the ' +
    'ocean" / "good stopping point" — text that punts a real task. ' +
    "Surfaces the deferral pathology so the supervisor can re-anchor " +
    "the work.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Deferral language is the worker's way of avoiding a concrete " +
        "next action — usually because it's hard, ambiguous, or the " +
        "worker isn't sure. The vocabulary is stable across instances: " +
        "'revisit', 'focused session', 'boil the ocean', 'stopping point'. " +
        "Catch the phrase, flag the punt.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::(we can revisit|focused session|boil the ocean|good stopping point)",
        "Action:  flag-pathology:deferral_vocabulary",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim. Until " +
        "that lands the match: trigger has no input to scan.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on long runs where deferral is a known failure " +
        "mode. The pathology flag is informational, not halting — the " +
        "supervisor decides whether to re-anchor or accept the punt.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::(we can revisit|focused session|boil the ocean|good stopping point)', 'flag-pathology:deferral_vocabulary');\n`,
  },
};
