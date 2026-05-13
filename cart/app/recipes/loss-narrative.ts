import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "loss-narrative",
  title: "Loss narrative without recovery check",
  instructions:
    'Worker claims "destroyed" / "filter-repo wiped" / "lost work" — ' +
    "inject a reminder to run git reflog and check for backup branches " +
    "before any recreation. Catches the 4-Claudes-deep pattern at step 2.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A loss narrative — 'work was destroyed', 'filter-repo wiped', " +
        "'I lost it' — is dangerous because the natural next move is " +
        "recreation. Recreation before recovery costs hours; reflog + " +
        "backup-branch check takes 30 seconds and usually finds the " +
        "work intact. The trigger catches the narrative; the action " +
        "redirects to the cheaper check first.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::(destroyed|filter-repo|wiped|lost work)",
        "Action:  inject-message:before recreating, run: git reflog | head -50 && ls .git/refs/",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim. The " +
        "inject-message action runtime is currently a stub — it emits " +
        "a bus event but does not yet write into the next user-prompt-" +
        "submit-hook payload. Until that lands the rule fires but the " +
        "injection is dropped.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on any run that touches git. Particularly " +
        "valuable when inheriting context from a previous session that " +
        "claimed loss — block the recreation reflex at the substrate " +
        "layer, not the prompt layer.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::(destroyed|filter-repo|wiped|lost work)', 'inject-message:before recreating, run: git reflog | head -50 && ls .git/refs/');\n`,
  },
};
