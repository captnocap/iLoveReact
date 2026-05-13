// onboarding-first-impression
//
// Doc + stamp co-authored in one file. Turns the cart/app onboarding
// hand-off (name from step 1, traits from step 3, goal from step 5,
// model picked at step 2) into a 2-turn flow that produces a
// first_impression.md the cart loads as the user's welcome state.
//
// Shape: clarify-then-write. Turn 1, the model asks the user 3 short
// clarifying questions about their goal that the onboarding fields
// alone don't answer. Turn 2, with the answers in hand, it writes
// the profile.
//
// Why this shape, not one-shot or enhance-rewrite: a 4-variant probe
// (V1 raw / V2 enhance-once / V3 clarify-loop / V4 clarify+enhance,
// see the companion .md) ran the same fixed onboarding sample twice
// through `bench/claude_runner` (a Zig CLI around
// framework/claude_sdk). V3 was the only variant that reproducibly
// produced a meta-observation about HOW the user answered (the
// "answered sideways" insight). V1 was a solid baseline; V2 was
// high-variance and occasionally fabricated facts; V4 reliably
// laundered voice into a clinical report and was 1.5–2× the cost
// of V3.
//
// Why the recipe ALSO ships a concern-structurer enhancer: two
// follow-up probes (conflict-resolution with an external trigger,
// and profile-recovery with a wrong-on-disk profile + upset
// pushback) ran twice each through the same harness. The
// structured-concerns enhancer reproducibly produced the best
// downstream output in both — layered emotional reads in one,
// system-level meta-correction ("chat sessions don't carry over;
// the notes file does, and mine was wrong") in the other. The
// quantification enhancer reproducibly cooled the prose AND
// narrowed the scope of correction (only fixed what was explicitly
// contested). So when the cart-side gate detects an upset / conflict
// turn, it should run the concern-structurer composition first and
// prepend its output to the writing turn's user-message.

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

// ── The two-turn contract ─────────────────────────────────────────────────

const CLARIFY_INSTRUCTION = `You are about to write a first_impression.md profile of a new user, but first you need a little more signal than the bare onboarding gave you. Before writing anything, ask the user 3 short clarifying questions — questions you genuinely cannot answer from the onboarding fields alone.

The cart renders your response as a real UI surface using the chat-loom tagset (see cart/chat-loom.tsx for the canonical reference). Emit the three questions as a single Form so the user can answer them all at once.

Output format on this turn ONLY:

Wrap the ENTIRE response in [ ... ]. Inside, use ONLY these tags:
  <Col>                          vertical container
  <Title>...</Title>             one short framing line above the form
  <Text>...</Text>               (optional) one-line lead-in
  <Form>                         wraps the questions
    <Field name="q1" label="full question text in plain language" placeholder="short hint" />
    <Field name="q2" label="..." placeholder="..." />
    <Field name="q3" label="..." placeholder="..." />
    <Submit reply="A1: {q1}\\nA2: {q2}\\nA3: {q3}">Send</Submit>
  </Form>

Rules:
- Always wrap the entire output in [ ... ].
- Exactly 3 <Field>s named q1, q2, q3 — the next turn parses on those names.
- The <Submit reply> attribute MUST be the exact template above. Each {qN} interpolates that field's value back into the user-turn reply.
- Labels are the actual questions in plain language ("What does breaking even mean to you in year one?"), not field-name shorthand.
- Placeholders are short hints — a few words.
- No other tags. No HTML. No markdown. No tools. Do not write the profile yet.`;

const WRITE_AFTER_CLARIFY_INSTRUCTION = `You now have onboarding context AND the user's answers to your clarifying questions (delivered as the user-turn message in "A1: ... / A2: ... / A3: ..." form, interpolated from the chat-loom Form you emitted last turn). Write a markdown profile of this user using the Write tool, at the path the cart wired into your system prompt.

Cover:
- Who they seem to be (synthesizing onboarding + answers)
- Their goal restated charitably in your own words
- The 3 things you'd still want to learn next (NEW ones, not the ones you already asked)
- Where you would want to be careful — what assumptions might still be wrong
- An opening message you'd send them (2-3 sentences) when they first open the app

Use the Write tool exactly once. Be specific. Don't hedge. Sign the file '— Claude (first impression)'.`;

// ── Concern-structurer enhancer ───────────────────────────────────────────
//
// The cart fires a SEPARATE upstream Claude session with this as its
// system prompt whenever the user's incoming message reads as upset /
// conflict-shaped. The enhancer's output (a structured set of concerns
// with "what addressing it looks like" guidance for each) is prepended
// to the writing turn's user-message before it reaches the writing
// Claude. See the companion .md for the cross-test reproducibility
// data driving the choice of structurer over the alternative
// quantifier shape.

const STRUCTURE_INSTRUCTION = `You are a concern-structurer. The user will hand you a single message someone sent to a chat assistant. The message contains an emotional outburst alongside an actual ask, OR the user is pushing back on a mistake the assistant just made. Extract the concerns surfaced and structure them so the receiving model can address each one without conflating them.

Output format (no preamble, no closing summary):

Concern 1: <short label>
- What it is:
- Whether the assistant can act on it:
- What addressing it looks like in the next reply:

Concern 2: ...

(3-5 concerns total. Crisp. One bullet per sub-line.)`;

// ── Doc form ──────────────────────────────────────────────────────────────

export const recipe: RecipeDocument = {
  slug: "onboarding-first-impression",
  title: "Onboarding first-impression — clarify, then write",
  sourcePath: "cart/app/recipes/onboarding-first-impression.md",
  instructions:
    "After the 5-step onboarding lands (name, provider, traits, config, goal), spawn a 2-turn session against the model the user picked. Turn 1: ask 3 clarifying questions (rendered as a chat-loom Form). Turn 2: write first_impression.md given the answers. The recipe also ships a concern-structurer enhancer composition the cart can fire when the user's incoming message reads as upset / conflict-shaped, in onboarding or any later session.",
  sections: [
    {
      kind: "paragraph",
      text:
        "The onboarding has 5 steps but only 3 carry signal forward — name (step 1), traits (step 3), and goal (step 5). Steps 2 and 4 pick the model and the working directory. The first-impression recipe takes that signal and generates a personalized welcome by spawning the picked model twice: once to ask the user three short questions the onboarding fields cannot answer, then once again — with the answers in hand — to write a profile to disk that the cart reads on app entry.",
    },
    {
      kind: "bullet-list",
      title: "Why two turns instead of one",
      items: [
        "Empirically tested against a fixed onboarding sample twice (Maya, 6 traits, an ambitious goal). The clarify-loop reproducibly produced a meta-observation the one-shot variant missed: noticing that the user answered logistical questions with feelings, working-style, and values rather than the literal data the questions asked for.",
        "Single-shot prompts produce competent profiles but miss the texture you only get from interaction. A prompt-enhancer pass adds variance without consistent quality gain — and stacked enhancers (clarify + enhance every input) reliably launder voice into a clinical report.",
        "Two-turn cost is roughly the same as one-turn ($0.11 against Claude Sonnet 4.6 in our runs); the clarifying-question turn is small.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Why a concern-structurer enhancer (and not a quantifier)",
      items: [
        "Two follow-up probes (conflict-resolution with an external trigger, and profile-recovery with a wrong-on-disk profile + upset pushback) ran twice each. The structured-concerns enhancer reproducibly produced the best downstream output in both: layered emotional reads in one, system-level meta-correction in the other (\"chat sessions don't carry over; the notes file does, and mine was wrong\").",
        "The alternative — a quantifying enhancer (intensity 0-10, displacement direction, etc.) — reproducibly cooled the prose AND narrowed the scope of correction to only what was explicitly contested. Useful when warmth doesn't matter; wrong default for an onboarding/identity context.",
        "The structurer's outputs are instruction-shaped (\"What addressing it looks like in the next reply: ...\"), which the writing model picks up as actionable guidance rather than data to bracket.",
      ],
    },
    {
      kind: "paragraph",
      title: "What's wired below",
      text:
        "The default JSX export stamps: a new src_onboarding-signal source kind that bundles step 1+3+5, a 'who' composition pinning the signal as identity context, three prompt fragments (turn-1 clarify, turn-2 write, concern-structurer enhancer), a prompt composition whose system slot uses first-match to swap between the clarify/write fragments based on whether answers are present, a SECOND prompt composition (comp_concern_structurer) the cart fires as a separate upstream Claude turn when the incoming message reads as upset, an event hook on system:claude:write for first_impression.md (the cart swaps from the onboarding shell to the welcome surface when it fires), and arming recommendations for two pathologies the recipe historically tripped: scope-collapse at T1 (locks onto a stereotype on the thin first read) and premature-commitment at T2 (the model wants to skip the clarifying turn).",
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe stamps a composition + event hook\n` +
      `  // (system:claude:write on first_impression.md). The IFTTT-shaped entry:\n` +
      `  //   useIFTTT('fs:changed:first_impression.md', 'send:onboarding:complete');\n` +
      `  // but the recipe's core behavior is a composition with first-match slot\n` +
      `  // swapping between clarify/write fragments — composition-shaped, not\n` +
      `  // a 2-node useIFTTT chain. Belongs as a stamp the scaffold points at.\n`,
  },
};

// ── Stamp form ────────────────────────────────────────────────────────────

export default function OnboardingFirstImpression() {
  return (
    <Recipe slug="onboarding-first-impression">
      <PromptFragment
        id="frag_onboarding_clarify"
        label="Turn 1 — ask 3 clarifying questions"
        body={CLARIFY_INSTRUCTION}
      />

      <PromptFragment
        id="frag_onboarding_write"
        label="Turn 2 — write first_impression.md given the answers"
        body={WRITE_AFTER_CLARIFY_INSTRUCTION}
      />

      <PromptFragment
        id="frag_concern_structurer"
        label="Enhancer — structure an upset/conflict-shaped message into concerns"
        body={STRUCTURE_INSTRUCTION}
      />

      <CompositionSourceKind
        id="src_onboarding-signal"
        label="onboarding signal"
        description="Bundles the three carrying-fields from cart/app/onboarding state.jsx — name (step 1), traits (step 3), goal (step 5) — formatted for the system prompt. Resolved at turn-assembly time by reading the OnboardingProvider context."
        applicableTo={["who", "context"]}
        refKind="computed"
      />

      <Composition
        id="comp_first_impression_who"
        kind="who"
        label="Onboarding signal pinned as identity"
        description="Extends the default 'who' composition with the 3 onboarding fields the user just gave, formatted as Name / Traits / Goal. Drives turn-1 question selection and turn-2 synthesis."
        inheritsFrom="comp_who_default"
      >
        <Slot
          name="identity"
          composer="concat"
          maxTokens={400}
          emptyBehavior="omit"
        >
          <Source kind="src_onboarding-signal" weight={1.0} />
        </Slot>
      </Composition>

      <Composition
        id="comp_first_impression_prompt"
        kind="prompt"
        label="Two-turn clarify-then-write — system slot"
        description="System slot resolves at turn-assembly time. Turn 1 (no scripted answers yet on the wire) selects the clarify fragment. Turn 2 (answers present) selects the write fragment. first-match composer with the write fragment ahead of the clarify fragment so turn 2 wins when its inputs are present."
        inheritsFrom="comp_prompt_default"
      >
        <Slot name="system" composer="first-match" emptyBehavior="fail">
          <Source kind="src_prompt-fragment" ref="frag_onboarding_write" />
          <Source kind="src_prompt-fragment" ref="frag_onboarding_clarify" />
        </Slot>
      </Composition>

      <Composition
        id="comp_concern_structurer"
        kind="prompt"
        label="Concern-structurer enhancer — fires upstream of the writing turn"
        description="Standalone single-turn prompt assembly. The cart fires this composition as a SEPARATE Claude session (no main-flow context) when the user's incoming message reads as upset / conflict-shaped. The session takes that one message as its user-turn input and emits a structured concern table. The cart prepends that table to the writing turn's user-message before it reaches the writing Claude. Three reproducible probes (first impressions / external upset / profile recovery) showed the structurer's instruction-shaped output ('What addressing it looks like in the next reply: ...') consistently produced richer downstream writes than the alternative quantifier shape."
      >
        <Slot name="system" composer="concat" emptyBehavior="fail">
          <Source kind="src_prompt-fragment" ref="frag_concern_structurer" />
        </Slot>
      </Composition>

      <EventHook
        match="system:claude:write"
        filter={{ filePathEndsWith: "first_impression.md" }}
        label="First-impression ready — swap cart from onboarding to welcome"
      >
        <Action
          kind="emit-event"
          message="onboarding:first-impression-ready"
          spec={{ surface: "app-shell" }}
        />
        <Action
          kind="mark-status"
          message="onboarding:complete"
          spec={{ persist: true }}
        />
      </EventHook>

      <Arming
        pattern="scope-collapse"
        tier="T1"
        reason="The onboarding signal is thin (3 fields). Without arming, the model locks onto a stereotype reading on turn 1 and the clarifying questions become generic. T1 keeps the model widening the read until the answers come in."
      />
      <Arming
        pattern="premature-commitment"
        tier="T2"
        reason="The model wants to skip the clarifying turn and write immediately. T2 keeps the two-turn split intact so the meta-observation (how the user answered, not just what) makes it into the profile."
      />
    </Recipe>
  );
}
