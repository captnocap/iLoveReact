import type { DocIndex } from '../types';

export const editor_curve_kit: DocIndex = {
  name: 'editor_curve_kit',
  file: 'editor_curve_kit.md',
  cart: 'cart/editor/data/curves.ts',
  purpose: ['geometry', 'asset_pipeline'],
  summary:
    'Everyday-curve helpers (arcs, conics, superellipse, centripetal splines, catenary, clothoid, helix, spirals, egg) as pure param→points functions, lathed/extruded into five File → New Mesh kinds (Vessel, Arch, Spring, Egg, Tray) through the ringLoft/outlinePrism stitchers; no resident curve objects, no offsets, arc-length-spaced outputs.',
  interfaces: [
    {
      name: 'curve kit / data/curves.ts',
      purpose: ['geometry'],
      kind: 'module',
      sourceFile: 'cart/editor/data/curves.ts',
      description:
        'Four tiers of pure generators: arcs/conic-rho/superellipse, freeform (curveThrough = centripetal Catmull-Rom — the cusp-proof parameterization; polyRound with per-corner clamped fillets), specialty analytics (catenary solved for endpoint+sag, clothoid curvature ramps, helix, log/archimedean/fermat spiral, Hügelschäffer egg/eggProfile, teardrop), and ring-stack generators (revolveRings, sweepRings with rotation-minimizing frames + taper/twist channels, resample, polylineInfo) plus arch/vesselProfile presets. Offsetting deliberately absent. Grounded in research_runs/2026-08-12__everyday-curves-modeling-algorithms/.',
      consumers: ['cart/editor/data/assetCatalog.ts'],
      status: 'live',
    },
    {
      name: 'loft stitchers / ringLoft + outlinePrism',
      purpose: ['geometry'],
      kind: 'module',
      sourceFile: 'cart/editor/model/editMesh.ts',
      description:
        'The bridge from curve samples to authored EditMesh topology: ringLoft walls equal-width ring stacks with quads, collapses pole rings to fans, caps open ends as single n-gons (cylinder-cap convention, req_3763); outlinePrism extrudes a closed 2D outline into a slab. Both normalize winding by whole-mesh signed volume so concave profiles orient correctly.',
      dependsOn: ['curve kit / data/curves.ts'],
      consumers: ['cart/editor/data/assetCatalog.ts'],
      status: 'live',
    },
    {
      name: 'curve primitive kinds / File → New Mesh',
      purpose: ['geometry', 'asset_pipeline'],
      kind: 'registry',
      sourceFile: 'cart/editor/data/assetCatalog.ts',
      description:
        'Vessel/Arch/Spring/Egg/Tray ride the SAME registry pipeline as cube/cylinder: a PRIMITIVE_MESHES row (data/commands.ts) mints both menu commands, PRIMITIVE_FIELDS describes the dialog knobs (NewMeshDialog has no per-kind code), primitiveParamsFromU converts u→meters key-list-driven, and primitiveEditMesh maps params onto curve samples + a stitcher. Arch rise picks the mason\'s strike (segmental / semicircular / gothic). Parts name from the registry at creation (V33).',
      dependsOn: ['curve kit / data/curves.ts', 'loft stitchers / ringLoft + outlinePrism'],
      consumers: ['cart/editor/shell/NewMeshDialog.tsx', 'cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'intent-named verbs emit points, never curve datatypes',
      purpose: ['geometry'],
      description:
        'The curve taxonomy lives in function names and presets; the representation stays sampled polylines and ring stacks the mesh document already understands. No resident curve objects, no NURBS, no new editing gizmos — a helper is one call away from loftable mesh data.',
      examples: ['editor_curve_kit'],
    },
  ],
  hazards: [],
};
