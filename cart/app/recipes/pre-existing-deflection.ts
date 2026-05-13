import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "pre-existing-deflection",
  title: '"Pre-existing" deflection',
  instructions:
    'Worker calls a bug "pre-existing" — surface for a quick git-log ' +
    "audit, since the worker may have authored the line in a recent edit.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "When a bug surfaces and the worker labels it 'pre-existing', " +
        "the claim is shifting responsibility off the current run. It " +
        "is sometimes accurate; it is also a common deflection from a " +
        "line the worker edited a few turns ago. Either way it deserves " +
        "a quick blame-check before being accepted.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::pre-existing",
        "Action:  notify-user:check git log; was this line yours?",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim. A " +
        "stronger version of this rule would cross-correlate with " +
        "fs:changed events on the same file in the recent run — that " +
        "needs absence-after-marker temporal logic the substrate " +
        "doesn't yet have.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally when the worker is doing bug-fix work. Combine " +
        "with a proc:spawn:'git log --follow <file>' action if you want " +
        "the audit to happen automatically rather than reminding the user.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::pre-existing', 'notify-user:check git log; was this line yours?');\n`,
  },
};
