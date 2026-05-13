import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "frontend-aesthetics-prompting-guide",
  title: "Frontend Aesthetics: A Prompting Guide",
  sourcePath: "cart/app/recipes/frontend-aesthetics-prompting-guide.md",
  instructions:
    "A prompt blob that pushes Claude away from generic 'AI slop' frontend defaults. In our stack it rides on the user message — the Claude branch of useAssistant doesn't expose a system_prompt opt yet (only openai_compat does) — so prepend it to every UI-generation turn.",
  sections: [
    {
      kind: "paragraph",
      text:
        "Claude can produce great frontends but tends toward generic, conservative defaults when not steered. This recipe is a single prompt blob you wrap your turn with so the output rejects the 'AI slop' aesthetic and commits to a specific design direction.",
    },
    {
      kind: "bullet-list",
      title: "When to use this",
      items: [
        "Any time you ask Claude to produce a TSX cart, page, component, or themed UI.",
        "Code generation for HTML/CSS demos.",
        "Style passes on existing components ('redo this in the spirit of …').",
        "Skip it for backend code, docs, refactors, or anything non-visual.",
      ],
    },
    {
      kind: "code-block",
      title: "The full aesthetics prompt block",
      language: "typescript",
      code: `export const FRONTEND_AESTHETICS_PROMPT = \`<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend
design, this creates what users call the "AI slop" aesthetic. Avoid this:
make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid
generic fonts like Arial and Inter; opt instead for distinctive choices that
elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for
consistency. Dominant colors with sharp accents outperform timid,
evenly-distributed palettes. Draw from IDE themes and cultural aesthetics
for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize
CSS-only solutions for HTML. Use Motion library for React when available.
Focus on high-impact moments: one well-orchestrated page load with
staggered reveals (animation-delay) creates more delight than scattered
micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid
colors. Layer CSS gradients, use geometric patterns, or add contextual
effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely
designed for the context. Vary between light and dark themes, different
fonts, different aesthetics. You still tend to converge on common choices
(Space Grotesk, for example) across generations. Avoid this: it is critical
that you think outside the box!
</frontend_aesthetics>\`;`,
    },
    {
      kind: "code-block",
      title: "Sending it through useAssistant",
      language: "tsx",
      code: `import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

function FrontendBuilder({ workspace, model, request }: { workspace: string; model: string; request: string }) {
  const { events, ask, ready } = useAssistant({
    backend: 'claude_code',
    cwd: workspace,
    model,
  });

  useEffect(() => {
    if (!ready() || !request) return;
    // No system_prompt opt for claude_code yet — concatenate into the user turn.
    ask(\`\${FRONTEND_AESTHETICS_PROMPT}\\n\\n\${request}\`);
  }, [ready(), request]);

  return <RenderEvents events={events} />;
}`,
    },
    {
      kind: "code-block",
      title: "Subset prompts for narrow control",
      language: "typescript",
      code: `export const TYPOGRAPHY_PROMPT = \`<typography>
Choose fonts that elevate the design. Avoid Inter, Roboto, Arial, and
system-ui defaults. Pair a distinctive display font with a comfortable
text font. Specify weights and sizes explicitly.
</typography>\`;

export const MOTION_PROMPT = \`<motion>
One orchestrated page-load reveal beats scattered micro-interactions.
Stagger appearance with animation-delay. Prefer CSS-only motion. Use the
Motion library for React when CSS won't reach.
</motion>\`;

export const COLOR_PROMPT = \`<color>
Commit to a cohesive palette. Use CSS variables. Dominant colors plus
sharp accents — not timid, evenly-distributed palettes. No purple
gradients on white. Draw from IDE themes and cultural aesthetics.
</color>\`;`,
    },
    {
      kind: "paragraph",
      title: "Validation",
      text:
        "Generate two variants of the same component, one with the prompt and one without. The non-prompted version usually picks Inter, a near-monochrome palette, and zero motion. The prompted version commits to a direction. If the prompted variant still feels generic, narrow the prompt to typography or color alone.",
    },
    {
      kind: "bullet-list",
      title: "Caveats and TODOs against the worker bindings",
      items: [
        "No system_prompt for claude_code in the worker opts. The openai_compat backend already accepts systemPrompt — wire it through framework/assistant/claude_sdk/options.zig and surface a systemPrompt opt for claude_code in framework/assistant/worker_bindings.zig. Concatenate into the user message today; move to the system slot when wired.",
        "No turn-history persistence by default. Each useAssistant mount spawns a fresh worker. Pass resumeSession to keep the conversation when the cart can supply a session id; otherwise re-send the aesthetics block per session.",
      ],
    },
    {
      kind: "bullet-list",
      title: "Pattern summary",
      items: [
        "Keep the aesthetics block as a TS string export so it's a one-liner to import anywhere.",
        "Concatenate ${AESTHETICS}\\n\\n${request} and pass that to ask().",
        "For narrow tasks, send a slice (typography / motion / color) instead of the full bundle.",
        "When systemPrompt opens up for claude_code in the worker bindings, move the block onto the system slot.",
      ],
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe is prompt-engineering content,\n` +
      `  // not an event-driven rule. Substrate gap: prompts aren't IFTTT-shaped;\n` +
      `  // they live on the assistant config layer, not the bus. Likely belongs\n` +
      `  // as a prompt-fragment composition rather than a recipe scaffold —\n` +
      `  // see the prompt-composition shape under cart/app/gallery/data/composition/.\n`,
  },
};
