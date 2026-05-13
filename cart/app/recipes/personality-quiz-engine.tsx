// personality-quiz-engine
//
// Doc + stamp co-authored. Defines the two-turn quiz loop that
// reads + writes the UserManifest. Author turn renders a chat-loom
// intent tree wrapped in [...]; infer turn ingests the answer and
// emits ManifestDelta[]. See companion .md for the gift-shaped
// framing rule, anti-repetition guardrail, and anomaly-detection
// lane.

import type { RecipeDocument } from "./recipe-document";
import {
  Action,
  Arming,
  Composition,
  CompositionSourceKind,
  EventHook,
  PromptFragment,
  Recipe,
  Slot,
  Source,
} from "./_stamp";

// ── Author turn — produces a chat-loom intent tree ─────────────────────

const QUIZ_AUTHOR_INSTRUCTION = `You are the active assistant character speaking to the user. You are about to author a single short quiz aimed at one or two manifest dimensions where your read of the user is still thin. The cart will render your output as a real UI surface using the chat-loom tagset (see cart/testing_carts/chat-loom.tsx for the canonical reference).

This must read as a GIFT, not a survey. The user should feel that you are offering them entertainment / insight / a mirror — not collecting data. If it reads as data collection, you have failed.

Output format on this turn ONLY:

Wrap the ENTIRE response in [ ... ]. Inside, use ONLY these tags:

  <Col>                          vertical container
  <Row>                          horizontal container
  <Title>...</Title>             one short framing line
  <Text>...</Text>               (optional) one-line kicker
  <Form>                         wraps multi-question quizzes
    <Field name="qN" label="..." placeholder="..." />
    <Submit reply="A1: {q1}\\nA2: {q2}\\nA3: {q3}">Send</Submit>
  </Form>
  <Btn reply="reply template">label</Btn>
  <Badge tone=neutral>...</Badge>
  <Divider />
  <Spacer size=md />

Rules:
- Always wrap the entire output in [ ... ].
- Pick EXACTLY ONE metaphor family per quiz: gas-station snack, desert island item, obsolete file format, weather, vehicle, kitchen tool, season, soundtrack, room, pet, instrument, weapon. Stick to it.
- If the cart's prior-context shows this dimension was quizzed within the last 5 sessions, you MUST pick a different metaphor family.
- One quiz per turn. Either a single <Form> with up to 3 <Field>s, OR a single row of 3-5 <Btn>s. Not both.
- Every <Btn reply> and <Submit reply> must use a template that reproduces the user's choice in a normalized form ("I picked: {q1}", "A1: {q1}\\nA2: {q2}").
- Lead with a <Title> that lands the gift. NEVER label it as a survey or quiz-of-data.
- No tools. No HTML. No markdown. No prose outside the [...].

The cart will save your output as a QuizSession row, parse the intent tree via runtime/intent/parser.parseIntent, and render it via runtime/intent/render.RenderIntent. Your tree IS the quiz UI.`;

// ── Infer turn — produces ManifestDelta[] JSON ─────────────────────────

const QUIZ_INFER_INSTRUCTION = `You authored a quiz aimed at specific manifest dimensions. The user has answered. Your job is to infer ManifestDelta[] entries that update the manifest.

Output format on this turn ONLY: a JSON array, nothing else.

Each element matches this shape:

{
  "dimensionId": "<one of the targeted dimensions>",
  "previousValue": "<the manifest's current value, or null if never set>",
  "nextValue": "<your inferred value — must conform to the dimension's axis options>",
  "confidenceDelta": <number in [-0.25, +0.25]>,
  "reason": "<one sentence, specific to this answer>"
}

Rules:
- Emit one delta per targeted dimension. Skip dimensions where the answer says nothing useful.
- Reinforcement (same value as previous): confidenceDelta in [+0.10, +0.20]. The user has confirmed what was already inferred.
- Fresh inference (no previous value): confidenceDelta in [+0.15, +0.25]. Modest — manifest stabilizes through repetition.
- Contradiction (different value, previous confidence > 0.6): confidenceDelta = 0. The cart routes contradictions to a re-check quiz; never overwrite a confident value here.
- Reasons must be specific to the answer. "User picked plain peanuts → reads as no-frills / craft over flash" is correct. "User answered" is not.
- Do not invent dimensions outside the targeted set. Do not output prose. Do not wrap the JSON in code fences.`;

// ── Reframer enhancer — picks a fresh metaphor ─────────────────────────

const QUIZ_REFRAME_INSTRUCTION = `You are about to author a quiz aimed at a manifest dimension that has been quizzed before through a specific metaphor family. The cart has flagged the prior metaphor as stale.

Pick a new metaphor family from this set, EXCLUDING the prior one:

  gas-station snack, desert island item, obsolete file format, weather, vehicle, kitchen tool, season, soundtrack, room, pet, instrument, weapon, color, plant, beverage, wallpaper.

Output ONLY the chosen family name on a single line, lowercase, no punctuation. The author turn will read this and use it as the metaphor scaffold. Do not output any other content.`;

// ── RecipeDocument export ─────────────────────────────────────────────

export const recipe: RecipeDocument = {
  slug: "personality-quiz-engine",
  title: "Personality quiz engine — gift-shaped discovery",
  sourcePath: "cart/app/recipes/personality-quiz-engine.md",
  instructions:
    "Two-turn loop reading + writing UserManifest. Turn 1 (author) produces a chat-loom intent tree wrapped in [...]; turn 2 (infer) produces ManifestDelta[] JSON. Reframer enhancer fires when the same dimension was quizzed recently. Anti-repetition via repetitionEmbedding cosine + metaphor-staleness arming.",
  sections: [
    {
      kind: "paragraph",
      text:
        "The cart fires the author composition (comp_quiz_author) against the active character; its output is the QuizSession.intentTreeJson, rendered through chat-loom's RenderIntent. When the user submits, the chat-loom round-trip emits system:quiz:answered. The cart fires the infer composition (comp_quiz_infer) against the same model; its output is the ManifestDelta[] that lands on the user manifest as confidence updates and source-quiz pointers.",
    },
    {
      kind: "bullet-list",
      title: "What the stamp deposits",
      items: [
        "Three PromptFragment rows: frag_quiz_author, frag_quiz_infer, frag_quiz_reframe_enhancer.",
        "Two CompositionSourceKind rows: src_user-manifest-snapshot, src_quiz-prior-context.",
        "Two Composition rows: comp_quiz_author (turn 1), comp_quiz_infer (turn 2).",
        "Three EventHook rows: system:quiz:rendered, system:quiz:answered, system:quiz:inferred.",
        "Three arming recommendations: scope-collapse (T1), premature-commitment (T2), metaphor-staleness (T1).",
      ],
    },
    {
      kind: "bullet-list",
      title: "Confidence calibration",
      items: [
        "Reinforcement (same value as previous): confidenceDelta in [+0.10, +0.20].",
        "Fresh inference: confidenceDelta in [+0.15, +0.25].",
        "Contradiction with confidence > 0.6: confidenceDelta = 0; route to re-check via manifest:anomaly-detected.",
        "Per-quiz delta is capped at +/-0.25 to prevent the manifest from snapping to a single answer.",
      ],
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe is a quiz-state-machine with\n` +
      `  // confidence updates and contradiction routing, not a 2-node useIFTTT\n` +
      `  // chain. Partial event-driven hook:\n` +
      `  //   useIFTTT('event:quiz.answer-submitted', 'send:manifest:update');\n` +
      `  // but the recipe's core is composition + per-quiz delta math that\n` +
      `  // lives outside the IFTTT graph. Belongs as a stamped composition.\n`,
  },
};

// ── JSX stamp ──────────────────────────────────────────────────────────

export default function PersonalityQuizEngine() {
  return (
    <Recipe slug="personality-quiz-engine">
      <PromptFragment
        id="frag_quiz_author"
        label="Turn 1 — author a chat-loom quiz"
        body={QUIZ_AUTHOR_INSTRUCTION}
      />
      <PromptFragment
        id="frag_quiz_infer"
        label="Turn 2 — infer ManifestDelta[] from the answer"
        body={QUIZ_INFER_INSTRUCTION}
      />
      <PromptFragment
        id="frag_quiz_reframe_enhancer"
        label="Reframer — pick a fresh metaphor family"
        body={QUIZ_REFRAME_INSTRUCTION}
      />

      <CompositionSourceKind
        id="src_user-manifest-snapshot"
        label="User manifest snapshot"
        description="Resolves the top-N highest-confidence ManifestDimension entries for the active user into a 'things I have inferred about you so far' preamble. computeScript params: thresholdConfidence, k."
        applicableTo={["who", "context"]}
        refKind="computed"
      />
      <CompositionSourceKind
        id="src_quiz-prior-context"
        label="Quiz prior context"
        description="Resolves to the last K QuizSessions for this user-manifest formatted as Q/A pairs (no inferences). Used by the author turn to build on prior answers per the spiral-design pattern."
        applicableTo={["prompt", "context"]}
        refKind="computed"
      />

      <Composition
        id="comp_quiz_author"
        kind="prompt"
        label="Quiz author — system slot"
        description="Composes the active character snapshot + manifest snapshot + prior-context + author fragment. The user-turn slot carries the under-sampled dimension list and the chosen metaphor scaffold (or null on first call, in which case the author picks)."
        inheritsFrom="comp_prompt_default"
      >
        <Slot name="system" composer="concat" emptyBehavior="fail">
          <Source kind="src_character-snapshot" weight={1.0} />
          <Source kind="src_user-manifest-snapshot" weight={0.8} />
          <Source kind="src_quiz-prior-context" weight={0.6} />
          <Source kind="src_prompt-fragment" ref="frag_quiz_author" weight={1.0} />
        </Slot>
      </Composition>

      <Composition
        id="comp_quiz_infer"
        kind="prompt"
        label="Quiz infer — system slot"
        description="Composes only the infer fragment in the system slot. The user-turn slot carries (question text, answer string, targeted dimension list with current values + confidence)."
      >
        <Slot name="system" composer="concat" emptyBehavior="fail">
          <Source kind="src_prompt-fragment" ref="frag_quiz_infer" weight={1.0} />
        </Slot>
      </Composition>

      <EventHook
        match="system:quiz:rendered"
        label="Quiz mounted in the UI"
      >
        <Action
          kind="mark-status"
          message="quiz:rendered"
          spec={{ persist: true }}
        />
      </EventHook>

      <EventHook
        match="system:quiz:answered"
        label="User submitted — queue infer turn"
      >
        <Action
          kind="mark-status"
          message="quiz:answered"
          spec={{ persist: true }}
        />
        <Action
          kind="queue-job"
          message="quiz:infer"
          spec={{ compositionId: "comp_quiz_infer" }}
        />
      </EventHook>

      <EventHook
        match="system:quiz:inferred"
        label="Manifest deltas landed — recompute compatibility"
      >
        <Action
          kind="mark-status"
          message="quiz:inferred"
          spec={{ persist: true }}
        />
        <Action
          kind="emit-event"
          message="manifest:updated"
          spec={{ surface: "app-shell" }}
        />
        <Action
          kind="queue-job"
          message="character-compatibility:recompute"
          spec={{ characterId: "<active>", userManifestId: "<active>" }}
        />
      </EventHook>

      <Arming
        pattern="scope-collapse"
        tier="T1"
        reason="A single quiz answer cannot generalize a manifest dimension. T1 keeps the read open: confidence rises through repetition, never through one answer."
      />
      <Arming
        pattern="premature-commitment"
        tier="T2"
        reason="The infer turn must not snap a dimension to a fresh value when the manifest holds a confident prior. T2 routes contradictions to the re-check lane."
      />
      <Arming
        pattern="metaphor-staleness"
        tier="T1"
        reason="If the same dimension has been quizzed in the last 5 sessions through the same metaphor family, the user reads it as déjà vu. T1 forces a different family even when the cosine repetition check passes."
      />
    </Recipe>
  );
}
