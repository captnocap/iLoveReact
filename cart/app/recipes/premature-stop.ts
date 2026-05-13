import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "premature-stop",
  title: "Premature end-turn",
  instructions:
    "An end_turn after a single tool call with no synthesis text. " +
    "Pair with turn:tool-count for the threshold side.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A worker that ends its turn after one tool call without " +
        "responding to the result is leaving work on the table. The " +
        "transcript marker is the stop_reason field; the supporting " +
        "evidence is the turn:tool-count being too low for the work " +
        "the user asked for.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::stop_reason.{0,20}end_turn",
        "Action:  flag-pathology:premature_stop",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim. A " +
        "stronger version of this rule would gate on turn:tool-count < " +
        "threshold so single-tool turns where one tool is the right " +
        "answer don't false-positive.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on runs where premature stopping is a known " +
        "failure mode. Pair with inject-message:'tool result not " +
        "addressed, continue' to force the next turn to engage with " +
        "whatever the abandoned tool returned.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::stop_reason.{0,20}end_turn', 'flag-pathology:premature_stop');\n`,
  },
};
