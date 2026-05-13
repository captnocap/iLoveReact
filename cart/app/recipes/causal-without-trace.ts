import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "causal-without-trace",
  title: "Causal claim without evidence",
  instructions:
    'Worker explains a crash with "because X" but no recent run / ' +
    "stack-trace event is in the session. Requires a follow-up trace " +
    "before the claim is acceptable.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "Causal claims about crashes are often invented rather than " +
        "observed — the worker pattern-matches a likely cause from the " +
        "surrounding code without actually running it. The fix is to " +
        "demand the trace or repro event before accepting the causal " +
        "narrative.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::(because|caused by|due to).{0,40}(null|crash|segfault)",
        "Action:  notify-user:claim needs a trace or repro behind it",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim. A " +
        "stronger version would correlate against absence of recent " +
        "proc:line:gdb or proc:line:<test> events in the session.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind on debugging tasks. The notify-user payload reminds you " +
        "to push back on unsubstantiated causal claims rather than " +
        "letting them shape the next action.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::(because|caused by|due to).{0,40}(null|crash|segfault)', 'notify-user:claim needs a trace or repro behind it');\n`,
  },
};
