import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "constraint-gate",
  title: "Constraint gate on task-completing",
  instructions:
    'When the sequencer transitions a task to "completing", fire ' +
    "evaluate against the bound constraint. The sequencer holds " +
    "task:<id>.complete until evaluate emits constraint:<id>.met. " +
    "Suffix is rewritten at bind time.",
  sourcePath: "",
  sections: [
    {
      kind: "paragraph",
      title: "Pattern",
      text:
        "The completing → complete transition is the substrate's " +
        "verification gate. The sequencer pauses there, fires every " +
        "bound constraint's evaluate action, and only advances to " +
        "complete once every constraint emits .met. Any .unmet routes " +
        "the task to blocked-by-constraint and surfaces to the user.",
    },
    {
      kind: "bullet-list",
      title: "Trigger / action",
      items: [
        "Trigger: task:.completing            (suffix filled at bind time)",
        "Action:  evaluate:must-touch-three-layers",
      ],
    },
    {
      kind: "paragraph",
      title: "Dependencies",
      text:
        "task:<id>.<status> source not yet registered (on the namespace " +
        "TODO list — see the canvas/page.tsx header comment). " +
        "evaluate:<constraintId> action runtime not yet registered. " +
        "Both are ~10 LOC additions and are load-bearing for the " +
        "sequencer's complete gate to work.",
    },
    {
      kind: "paragraph",
      title: "When to use it",
      text:
        "Bind on any task whose acceptance criteria can be expressed " +
        "as a constraint over the worker's event stream. The example " +
        "constraint id 'must-touch-three-layers' would require fs: " +
        "events touching a Zig host, a V8 binding, and a React hook " +
        "before the task can complete.",
    },
  ],
  scaffold: {
    body: `  useIFTTT('task:.completing', 'evaluate:must-touch-three-layers');\n`,
  },
};
