import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "manifest-as-truth",
  title: 'Claim of "done" without test',
  instructions:
    'When the worker says "fixed" / "done" / "shipped" in its turn ' +
    "output, flag the manifest-as-truth pathology so the supervisor can " +
    "require a verification event (test run, binary launch) before " +
    "accepting the claim.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "A worker frequently writes 'fixed' or 'shipped' the moment an " +
        "edit lands, before any verification has run. The claim is the " +
        "manifest, not the truth. Flagging it as a pathology forces the " +
        "supervisor to require a real evidence event (test passed, " +
        "binary ran, gate cleared) before the run accepts the claim.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: match:claude:text::(fixed|done|shipped)",
        "Action:  flag-pathology:manifest_as_truth",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "Channel claude:text rides on the transcript-tail shim (not yet " +
        "wired — see the canvas/page.tsx header comment). This template " +
        "loads as shape only until that channel lands; the match: trigger " +
        "fires nothing without input on the channel.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind globally on any run where worker self-reports drive the " +
        "next step. Pair with a verify-gate rule that consumes the " +
        "pathology flag and demands a test or run event before clearing.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('match:claude:text::(fixed|done|shipped)', 'flag-pathology:manifest_as_truth');\n`,
  },
};
