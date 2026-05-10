// build-agents-that-remember-your-users
//
// Doc + stamp co-authored in one file (per cart/app/sequencer.md):
//   - `recipe`           — RecipeDocument; powers the gallery doc view.
//   - default export     — JSX stamp; expands into Composition + EventHook
//                          + arming rows when dropped on the canvas.
//
// Runtime evidence: validated end-to-end against the live `claude` CLI in
// /tmp/recipe_test_personality.py — 4 sessions, 14/15 assertions passing,
// ./profile.md grew 1525 → 4251 → 4396 → 5656 bytes across visits as
// Claude built up a 10-section personality model with adaptive style.

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

// ── The persistent-memory contract ────────────────────────────────────────

const PERSONALITY_INSTRUCTION = `You are a personal shopping assistant who builds a rich personality model of the customer over time.

This workspace holds one customer's evolving profile in ./profile.md. Treat it as a working document of who they are.

At the start of every conversation:
1. Read ./profile.md if it exists.
2. Adapt your tone, depth, and recommendations to match what you find.

After responding, update ./profile.md with anything new you noticed:
- Communication style (terse vs verbose, formal vs casual, emotionally expressive vs reserved)
- Emotional context they carry into the conversation
- Values that drive their choices (ethics, aesthetics, practicality, novelty)
- Decision-making patterns (impulsive, deliberate, comparison-driven, intuitive)
- Contradictions or evolutions in their preferences (don't overwrite — append the evolution)
- Triggers and past frustrations
- Language they use about themselves

Use these sections (create lazily, prefer Edit over Write once the file exists):
  # Communication style
  # Emotional state across visits
  # Values
  # Decision patterns
  # Hard constraints
  # Soft preferences
  # Contradictions and evolutions
  # Language patterns
  # Other notes

Keep entries short and skimmable. When a preference evolves, append a new bullet rather than rewriting — the history matters for future conversations.`;

// ── Doc form ──────────────────────────────────────────────────────────────

export const recipe: RecipeDocument = {
  slug: "build-agents-that-remember-your-users",
  title: "Build agents that remember your users",
  sourcePath: "cart/app/recipes/build-agents-that-remember-your-users.md",
  instructions:
    "Persist customer preferences across sessions by treating the session's cwd as a memory store. Per-customer workspace directory + a pinned profile.md Claude reads at session start and edits when it learns something new. Validated end-to-end against the live claude CLI.",
  sections: [
    {
      kind: "paragraph",
      text:
        "Most agents start every conversation from scratch. The original Anthropic recipe solves this with the Claude Managed Agents memory_store beta — cloud-hosted, mounted at /mnt/memory/{store}. We don't have that. framework/claude_sdk/ drives the local claude CLI; the closest analog is the session's cwd. Each customer gets their own directory; Claude reads/edits profile.md inside it.",
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "One directory per customer; pass it as cwd to useAssistant({ backend: 'claude_code', cwd, model }).",
        "Pin Claude to a known filename (profile.md) and a known schema in the prompt.",
        "First turn: Claude finds nothing, writes the file.",
        "Second turn onwards: same cwd, Claude reads first, recommendations land pre-personalized.",
        "Cart-side: useIFTTT('system:claude:edit', …) on profile.md to surface 'memory updated'.",
      ],
    },
    {
      kind: "paragraph",
      title: "What's wired below",
      text:
        "The default JSX export stamps: a new src_cwd-memory-file source kind, a `who` composition that pins ./profile.md as long-term memory, a `prompt` composition that wraps user turns with the memory contract, an event hook that surfaces a 'memory updated' indicator when Claude edits profile.md, and recommended arming for two pathologies the recipe historically tripped (scope-collapse at T1, canonical-pivot at T2 — customers can rationalize away their own evolved preferences).",
    },
  ],
};

// ── Stamp form ────────────────────────────────────────────────────────────

export default function RememberYourUsers() {
  return (
    <Recipe slug="build-agents-that-remember-your-users">
      <PromptFragment
        id="frag_personality_capture"
        label="Personality memory contract"
        body={PERSONALITY_INSTRUCTION}
      />

      <CompositionSourceKind
        id="src_cwd-memory-file"
        label="cwd memory file"
        description="Reads a file inside Session.cwd. inlineValue holds the relative path. Resolved at turn-assembly time by the framework's fs helper."
        applicableTo={["who", "context"]}
        refKind="inline-text"
      />

      <Composition
        id="comp_personality_who"
        kind="who"
        label="Personality memory: ./profile.md"
        description="Extends the default `who` composition by pinning ./profile.md as the long-term-memory slot."
        inheritsFrom="comp_who_default"
      >
        <Slot
          name="memory"
          composer="merge-deduped"
          maxTokens={2000}
          emptyBehavior="omit"
        >
          <Source kind="src_cwd-memory-file" inlineValue="profile.md" weight={1.0} />
        </Slot>
      </Composition>

      <Composition
        id="comp_personality_prompt"
        kind="prompt"
        label="Personality memory contract — wraps user turns"
        description="Extends the default prompt composition; the system slot prepends the personality-capture fragment so every turn carries the memory contract."
        inheritsFrom="comp_prompt_default"
      >
        <Slot name="system" composer="concat" emptyBehavior="omit">
          <Source kind="src_prompt-fragment" ref="frag_personality_capture" />
        </Slot>
      </Composition>

      <EventHook
        match="system:claude:edit"
        filter={{ filePathEndsWith: "profile.md" }}
        label="Memory-updated indicator"
      >
        <Action
          kind="notify-user"
          message="memory updated"
          spec={{ severity: "info", surface: "profile-pane" }}
        />
      </EventHook>

      <Arming
        pattern="scope-collapse"
        tier="T1"
        reason="Customer evolves preferences over visits — don't lock the agent into the first stated constraint."
      />
      <Arming
        pattern="canonical-pivot"
        tier="T2"
        reason="Watch for 'I'd ideally ___ but I'll just ___' in the customer's own voice; surfaces unresolved preference conflicts the profile should record."
      />
    </Recipe>
  );
}
