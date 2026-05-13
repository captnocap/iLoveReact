import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "tick-heartbeat",
  title: "Heartbeat",
  instructions:
    "Fire a tick every 5 seconds. Pair with flag-pathology on a match " +
    "trigger to build a stuck-loop detector.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A heartbeat by itself is just a log line every interval. Its " +
        "real value is as a clock other rules count against — combine " +
        "with count: or repeat: to detect things that should happen " +
        "within N ticks but didn't.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: timer:every:5000",
        "Action:  log:tick",
      ],
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Tune the interval to the rhythm of your run. Bind globally as " +
        "the substrate clock or task-scoped as a per-task watchdog. " +
        "Remove when you no longer need the heartbeat traces.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('timer:every:5000', 'log:tick');\n`,
  },
};
