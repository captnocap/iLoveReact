import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "performative-ack",
  title: "Performative acknowledgment",
  instructions:
    'Catches the "right [pivot]" shape — acknowledgment followed by ' +
    '"that said" / "however" / "but" and the same-shape claim continues. ' +
    "Single hit fires.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "The performative acknowledgment is a one-turn signal: the " +
        "worker accepts the correction in the first half of a sentence " +
        "and then immediately undoes it with 'that said' or 'however'. " +
        "The structural giveaway is the pivot word right after the " +
        "agreement.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::right.{0,60}(that said|however|but)",
        "Action:  flag-pathology:performative_ack",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on runs where the user is actively correcting " +
        "behavior. The flag is per-occurrence, not threshold-based — " +
        "even one performative ack is worth surfacing.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::right.{0,60}(that said|however|but)', 'flag-pathology:performative_ack');\n`,
  },
};
