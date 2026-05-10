# Frontend Aesthetics: A Prompting Guide

Claude can produce great frontends but tends toward generic, conservative defaults when not steered. This recipe is a single prompt blob you wrap your turn with so the output rejects the "AI slop" aesthetic and commits to a specific design direction.

In our stack the prompt rides on the user message — the `claude_code` branch of `useAssistant` doesn't expose a `systemPrompt` opt yet (only `openai_compat` does). Until that opens up, prepend the aesthetics block to every turn that asks Claude to generate UI.

## When to use this

- Any time you ask Claude to produce a TSX cart, page, component, or themed UI.
- Code generation for HTML/CSS demos.
- Style passes on existing components ("redo this in the spirit of …").

Skip it for backend code, docs, refactors, or anything non-visual.

## The prompt block

```typescript
export const FRONTEND_AESTHETICS_PROMPT = `<frontend_aesthetics>
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
</frontend_aesthetics>`;
```

## Sending it through useAssistant

```tsx
import { useEffect } from 'react';
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

function FrontendBuilder({ workspace, model, request }: { workspace: string; model: string; request: string }) {
  const { events, ask, ready } = useAssistant({
    backend: 'claude_code',
    cwd: workspace,
    model,
  });

  useEffect(() => {
    if (!ready() || !request) return;
    // No system_prompt opt for claude_code yet — concatenate into the user turn.
    ask(`${FRONTEND_AESTHETICS_PROMPT}\n\n${request}`);
  }, [ready(), request]);

  return <RenderEvents events={events} />;
}
```

`request` is the actual ask: "build me a settings panel for…", "redesign this card with…". The aesthetics block reframes how Claude approaches it.

## Subset prompts for narrow control

The full block is broad. When you only care about one dimension, send the relevant slice — short prompts steer better than long ones the model has to weight.

```typescript
export const TYPOGRAPHY_PROMPT = `<typography>
Choose fonts that elevate the design. Avoid Inter, Roboto, Arial, and
system-ui defaults. Pair a distinctive display font with a comfortable
text font. Specify weights and sizes explicitly.
</typography>`;

export const MOTION_PROMPT = `<motion>
One orchestrated page-load reveal beats scattered micro-interactions.
Stagger appearance with animation-delay. Prefer CSS-only motion. Use the
Motion library for React when CSS won't reach.
</motion>`;

export const COLOR_PROMPT = `<color>
Commit to a cohesive palette. Use CSS variables. Dominant colors plus
sharp accents — not timid, evenly-distributed palettes. No purple
gradients on white. Draw from IDE themes and cultural aesthetics.
</color>`;
```

Use one or two of these instead of the full bundle when you're doing a focused style pass.

## Validation

Generate two variants of the same component, one with the prompt and one without. The non-prompted version usually picks Inter, a near-monochrome palette, and zero motion. The prompted version commits to a direction. If the prompted variant still feels generic, narrow the prompt to typography or color alone.

## Caveats and TODOs against the worker bindings

- **No `systemPrompt` for `claude_code` in the worker opts.** `framework/assistant/claude_sdk/options.zig` already has the field; the Claude branch of `useAssistant` doesn't surface it. The `openai_compat` backend already accepts `systemPrompt` — wire the same opt through `framework/assistant/worker_bindings.zig` for the Claude path. Today we concatenate into the user message; when wired, move this prompt onto the system slot so it doesn't eat the turn budget.
- **No turn-history persistence by default.** Each `useAssistant` mount spawns a fresh worker. The aesthetics block has to be re-sent every time, until you supply `resumeSession` to restore a prior conversation.

## Pattern summary

1. Keep the aesthetics block as a TS string export so it's a one-liner to import anywhere.
2. Concatenate `${AESTHETICS}\n\n${request}` and pass that to `ask()`.
3. For narrow tasks, send a slice (typography / motion / color) instead of the full bundle.
4. When `systemPrompt` opens up for `claude_code` in the worker bindings, move the block onto the system slot.
