// game/figure/ — GAME_FIGURE: the character kit (V2/V2-AMENDED). CAPTURE PENDING.
//
// The head_lab kit (parts/hed/figureRender/ragdoll-behavior + the BAKE entry —
// author in JS, bake into the host) is REWRITTEN into here by its capture lane
// (V17-TRIAGE: head_lab's editor UI becomes editors/characters/, only the kit
// lands here). This door exists now so every lab already writes the standard
// import (V17); it exports nothing fake.

export const GAME_FIGURE = Object.freeze({
  status: 'capture-pending' as const,
});
