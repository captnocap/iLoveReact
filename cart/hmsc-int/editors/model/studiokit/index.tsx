// editors/model/studio/index.tsx — the public entry for the decomposed Studio.
//
// Side-by-side rebuild of editors/model/Studio.tsx (req_1386 → req_1390). The
// original file is FROZEN and untouched as the diff breadcrumb; this tree is the
// restructure. The sole external consumer (editors/workbench/model/source.tsx)
// imports StudioEditor from here when swapped in — a one-line cutover, reversible
// by flipping that line back to '../../model/Studio'.
//
// Decomposition is in progress (see STUDIO_REFACTOR_PLAN.html): the viewport body
// currently lives in ./StudioViewport.tsx as a behavior-identical copy and is
// being carved into config / helpers / hooks / panels / dialogs without changing
// what any of it DOES. Every export below keeps its original signature.

export { STUDIO, StudioViewport, StudioEditor, StudioRoute } from './StudioViewport';
