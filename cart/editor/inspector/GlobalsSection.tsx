// inspector/GlobalsSection.tsx — the PHYSICS GLOBALS focus panel (GLOBALS
// req_2770), shown while the playtest tab is in view.
//
// One OverrideField row per tunable (the shared stepper on the fixed column
// grid, req_2626 II), sectioned by the canonical table's groups
// (data/globals.ts). The inherit/override semantics map onto tuning naturally:
// a field at the game default renders dimmed ("inherits the game default"), a
// tuned field shows the live value + the ↺ chip that resets it. Every click
// lands in EditorState → the playtest surface pushes the live door → the next
// physics step runs it → the micro-save locks it in.
import { C, accentFor } from '../workspace.cls';
import { physicsGlobalGroups, type PhysicsGlobals } from '../data/globals';
import OverrideField from './OverrideField';

export default function GlobalsSection(props: {
  physics: PhysicsGlobals;
  onSet: (field: string, value: number) => void;
  onReset: (field: string) => void;
}) {
  return (
    <>
      {physicsGlobalGroups().map((group) => (
        <C.HW_Section key={group.group}>
          <C.HW_SectionHead>
            <C.HW_AccentBar style={{ backgroundColor: accentFor('info') }} />
            <C.HW_SectionTitle style={{ color: accentFor('info') }}>{group.group}</C.HW_SectionTitle>
          </C.HW_SectionHead>
          {group.props.map((p) => {
            const live = props.physics[p.path as keyof PhysicsGlobals];
            return (
              <OverrideField
                key={p.path}
                prop={p}
                value={live === p.base ? undefined : live}
                onSet={(field, v) => props.onSet(field, v as number)}
                onClear={props.onReset}
              />
            );
          })}
        </C.HW_Section>
      ))}
    </>
  );
}
