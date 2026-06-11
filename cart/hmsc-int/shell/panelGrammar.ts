// shell/panelGrammar.ts — the PANEL GRAMMAR (PANELGRAMMAR-0610, structure
// review §11.4). The PanelSpec system made panels CHEAP to emit; this module
// is the composition LAW layer, enforced where deep-interfaces says to
// enforce — at the boundary, in the one renderer — so no source can quietly
// dump its state shape raw onto the screen again.
//
// DATA ONLY, NO REACT (the decal.ts idiom): pure spec analysis, testable
// headless. PanelGroups consults it and warns LOUDLY (once per offending
// panel shape); it does not refuse to render — a broken panel teaches, a
// blank one hides. Each rule cites its ruling.
//
// The laws this module can see in a spec (the rest live in the renderer's
// own constants — widths are renderer-owned per L3 — or in review work):
//   G1  repeated group shapes are ILLEGAL (§11.4 rule 4, the buildings fix
//       made a rule): two groups with identical field signatures must factor
//       into ONE group + a selector field. GUIDING_LIGHT's factor law in UI.
//   G2  one color system per panel (§11.4 rule 3): more color fields than
//       COLOR_FIELD_CAP is the swatch-dump disease; a quick-pick palette
//       longer than QUICK_PICK_CAP must graduate to wheel+range.
//   G3  verb caps (§11.4 rule 5, req_0184's chip-wall verdict): more act
//       fields than ACT_CAP in one group wants t:'pick'/a grouped chooser.
//   G4  undo/redo/save render ONCE (§11.4 rule 7): the shell owns them
//       (bench chords + hero); a panel re-emitting them duplicates the verb.

import type { PanelSpec } from './fields';

// Named thresholds — UI-law constants, not game values (P2 governs game
// numbers; these are the renderer's own grammar.)
export const PANEL_GRAMMAR_CAPS = Object.freeze({
  /** color fields per PANEL before it reads as a swatch dump */
  COLOR_FIELD_CAP: 3,
  /** quick-pick swatches per color field before wheel+range is demanded */
  QUICK_PICK_CAP: 12,
  /** act fields per GROUP before a pick/grouped chooser is demanded */
  ACT_CAP: 6,
});

export type GrammarViolation = { law: 'G1' | 'G2' | 'G3' | 'G4'; group?: string; detail: string };

/** a group's SHAPE — the ordered (type:label) list. Two groups sharing one
 *  are the same control set dressed twice. */
export function groupSignature(group: PanelSpec['groups'][number]): string {
  return group.fields.map((f) => `${f.t}:${f.k}`).join(',');
}

const SHELL_VERBS = ['undo', 'redo', 'save'];

export function panelGrammarViolations(spec: PanelSpec): GrammarViolation[] {
  const out: GrammarViolation[] = [];

  // G1 — identical group shapes
  const bySig = new Map<string, string[]>();
  for (const g of spec.groups) {
    if (g.fields.length < 2) continue; // one-field groups can collide honestly
    const sig = groupSignature(g);
    bySig.set(sig, [...(bySig.get(sig) ?? []), g.title]);
  }
  for (const titles of bySig.values()) {
    if (titles.length > 1) {
      out.push({ law: 'G1', detail: `groups [${titles.join(', ')}] share one field signature — factor into ONE group + a selector field (§11.4 rule 4)` });
    }
  }

  // G2 — the color system
  let colorFields = 0;
  for (const g of spec.groups) {
    for (const f of g.fields) {
      if (f.t !== 'color') continue;
      colorFields += 1;
      if ((f.opts?.length ?? 0) > PANEL_GRAMMAR_CAPS.QUICK_PICK_CAP && !f.wheel && !f.range) {
        out.push({ law: 'G2', group: g.title, detail: `color "${f.k}" carries ${f.opts!.length} quick-picks with no wheel/range — graduate it (cap ${PANEL_GRAMMAR_CAPS.QUICK_PICK_CAP})` });
      }
    }
  }
  if (colorFields > PANEL_GRAMMAR_CAPS.COLOR_FIELD_CAP) {
    out.push({ law: 'G2', detail: `${colorFields} color fields in one panel (cap ${PANEL_GRAMMAR_CAPS.COLOR_FIELD_CAP}) — one color system per panel, presented once per task` });
  }

  // G3 — verb caps per group
  for (const g of spec.groups) {
    const acts = g.fields.filter((f) => f.t === 'act').length;
    if (acts > PANEL_GRAMMAR_CAPS.ACT_CAP) {
      out.push({ law: 'G3', group: g.title, detail: `${acts} act fields (cap ${PANEL_GRAMMAR_CAPS.ACT_CAP}) — use t:'pick'/a grouped chooser (req_0184)` });
    }
  }

  // G4 — shell verbs re-emitted
  for (const verb of SHELL_VERBS) {
    const owners = spec.groups.filter((g) => g.fields.some((f) => f.t === 'act' && f.k.toLowerCase() === verb)).map((g) => g.title);
    if (owners.length > 0) {
      out.push({ law: 'G4', detail: `"${verb}" emitted by [${owners.join(', ')}] — the shell owns undo/redo/save (bench chords + hero), panels never re-emit them` });
    }
  }

  return out;
}
