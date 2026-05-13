import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "stuck-loop",
  title: "Stuck loop",
  instructions:
    "When the same verb (tool invocation) fails three times in a row, " +
    "flag the stuck-loop pathology so the supervisor can intervene " +
    "before the worker burns more budget repeating the same failure.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A worker that fails the same verb three times running is " +
        "almost always in a stuck loop — the failure mode is repeating, " +
        "not evolving. Letting it continue costs tokens and clouds the " +
        "trace. Catching it at three consecutive failures gives early " +
        "warning without false-positives on a single retry.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: count:verb:lifecycle::failed:3",
        "Action:  flag-pathology:stuck_loop",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "None — rides on the existing verb:lifecycle channel from " +
        "runtime/hooks/ifttt-supervisor. Works today.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind to the Global row of the sequencer for any run where the " +
        "worker can retry tool calls. Pairs well with halt-run if you " +
        "want a hard stop, or kick-to-supervisor if you want a soft " +
        "escalation that the user resolves.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('count:verb:lifecycle::failed:3', 'flag-pathology:stuck_loop');\n`,
  },
};
