// inspector/RigSection.tsx — the model-surface RIG editor (req_2712/2713).
//
// Rigging a prop = declaring what its bones MEAN before export: searchable
// pockets (loot category, open/locked/keyed access), placement surfaces
// (tabletops items can be set on), seats, cover, kickable dynamics — authored
// as a PropRig draft that Export → Prop compiles into the package
// manifest's skeleton (runtime/skeleton/rigs.ts owns the mapping, req_2718
// disk truth).
//
// Controls sit on the shared inspector column grid (req_2626 II): label column,
// [−] value [+] steppers / value-cycle chips, reserved end column — the exact
// OverrideField idiom.
import { C, accentFor } from '../workspace.cls';
import {
  describePropRig,
  LOOT_CATEGORIES,
  CONTAINER_ACCESS,
  type PropRig,
  type CoverClass,
} from '../../../runtime/skeleton';

// Enable-time defaults, mirroring the old prop table's common rows (a junk
// container searched in 3s with a coin-flip fill; a 0.45m chair; a kickable
// trash-can body). All editable the moment the capability is on.
const DEFAULT_CONTAINER: NonNullable<PropRig['container']> = { slots: 2, lootCategory: 'junk', access: 'open', searchSeconds: 3, spawnFillChance: 0.5 };
const DEFAULT_SEAT: NonNullable<PropRig['seat']> = { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 };
const DEFAULT_DYNAMICS: NonNullable<PropRig['dynamics']> = { bodyRadiusMeters: 0.3, restitution: 0.4 };

const COVER_CYCLE: (CoverClass | undefined)[] = [undefined, 'soft', 'hard'];

function cycleNext<T>(options: readonly T[], current: T): T {
  const at = options.indexOf(current);
  return options[(at + 1) % options.length]!;
}

/** [−] value [+] stepper on the shared grid. */
function StepRow(props: { label: string; value: number; step: number; min: number; max: number; fmt?: (v: number) => string; onSet: (v: number) => void }) {
  const clamp = (v: number) => Math.max(props.min, Math.min(props.max, Math.round(v / props.step) * props.step));
  const fmt = props.fmt ?? ((v: number) => (props.step < 1 ? v.toFixed(2) : String(Math.round(v))));
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{props.label}</C.HW_FormLabel>
      <C.HW_Spacer />
      <C.HW_OvBtn onPress={() => props.onSet(clamp(props.value - props.step))}><C.HW_OvBtnText>−</C.HW_OvBtnText></C.HW_OvBtn>
      <C.HW_OvVal>{fmt(props.value)}</C.HW_OvVal>
      <C.HW_OvBtn onPress={() => props.onSet(clamp(props.value + props.step))}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
      <C.HW_OvResetIdle />
    </C.HW_ReadRow>
  );
}

/** On/Off toggle on the shared grid. */
function ToggleRow(props: { label: string; on: boolean; tooltip: string; onToggle: () => void }) {
  const Toggle = props.on ? C.HW_OvToggleOn : C.HW_OvToggle;
  const Txt = props.on ? C.HW_OvToggleTextOn : C.HW_OvToggleText;
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{props.label}</C.HW_FormLabel>
      <C.HW_Spacer />
      <Toggle tooltip={props.tooltip} onPress={props.onToggle}>
        <Txt>{props.on ? 'On' : 'Off'}</Txt>
      </Toggle>
      <C.HW_OvResetIdle />
    </C.HW_ReadRow>
  );
}

/** A value-cycle chip: shows the CURRENT value, click advances to the next. */
function CycleRow(props: { label: string; value: string; tooltip: string; onNext: () => void }) {
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{props.label}</C.HW_FormLabel>
      <C.HW_Spacer />
      <C.HW_OvToggleOn tooltip={props.tooltip} onPress={props.onNext}>
        <C.HW_OvToggleTextOn>{props.value}</C.HW_OvToggleTextOn>
      </C.HW_OvToggleOn>
      <C.HW_OvResetIdle />
    </C.HW_ReadRow>
  );
}

export default function RigSection(props: { rig: PropRig; onChange: (rig: PropRig) => void }) {
  const { rig } = props;
  const patch = (part: Partial<PropRig>) => props.onChange({ ...rig, ...part });
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('warning') }} />
        <C.HW_SectionTitle style={{ color: accentFor('warning') }}>RIG</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>{describePropRig(rig)}</C.HW_KeyText>
      </C.HW_SectionHead>

      <ToggleRow
        label="searchable"
        on={!!rig.container}
        tooltip="items can be searched out of this prop's pockets"
        onToggle={() => patch({ container: rig.container ? undefined : { ...DEFAULT_CONTAINER } })}
      />
      {rig.container ? (
        <>
          <StepRow label="pockets" value={rig.container.slots} step={1} min={1} max={8}
            onSet={(slots) => patch({ container: { ...rig.container!, slots } })} />
          <CycleRow label="loot" value={rig.container.lootCategory}
            tooltip="which loot table fills the pockets"
            onNext={() => patch({ container: { ...rig.container!, lootCategory: cycleNext(LOOT_CATEGORIES, rig.container!.lootCategory) } })} />
          <CycleRow label="access" value={rig.container.access}
            tooltip="open = free search · locked = needs force · keyed = needs its key"
            onNext={() => patch({ container: { ...rig.container!, access: cycleNext(CONTAINER_ACCESS, rig.container!.access) } })} />
          <StepRow label="search s" value={rig.container.searchSeconds} step={0.5} min={0.5} max={20}
            onSet={(searchSeconds) => patch({ container: { ...rig.container!, searchSeconds } })} />
          <StepRow label="fill" value={rig.container.spawnFillChance} step={0.05} min={0} max={1}
            onSet={(spawnFillChance) => patch({ container: { ...rig.container!, spawnFillChance } })} />
        </>
      ) : null}

      <StepRow label="placements" value={rig.placements ?? 0} step={1} min={0} max={8}
        onSet={(n) => patch({ placements: n > 0 ? n : undefined })} />

      <ToggleRow
        label="seat"
        on={!!rig.seat}
        tooltip="players can sit/lay on this prop"
        onToggle={() => patch({ seat: rig.seat ? undefined : { ...DEFAULT_SEAT } })}
      />
      {rig.seat ? (
        <>
          <CycleRow label="pose" value={rig.seat.pose}
            tooltip="sit (chair/bench) or lay (bed)"
            onNext={() => patch({ seat: { ...rig.seat!, pose: rig.seat!.pose === 'sit' ? 'lay' : 'sit' } })} />
          <StepRow label="height m" value={rig.seat.seatHeightMeters} step={0.05} min={0.1} max={2}
            onSet={(seatHeightMeters) => patch({ seat: { ...rig.seat!, seatHeightMeters } })} />
          <StepRow label="capacity" value={rig.seat.capacity} step={1} min={1} max={6}
            onSet={(capacity) => patch({ seat: { ...rig.seat!, capacity } })} />
        </>
      ) : null}

      <CycleRow label="cover" value={rig.cover ?? 'none'}
        tooltip="stealth/combat cover this prop provides"
        onNext={() => patch({ cover: cycleNext(COVER_CYCLE, rig.cover) })} />

      <ToggleRow
        label="kickable"
        on={!!rig.dynamics}
        tooltip="a dynamic body — kicks and rolls instead of standing solid"
        onToggle={() => patch({ dynamics: rig.dynamics ? undefined : { ...DEFAULT_DYNAMICS } })}
      />
      {rig.dynamics ? (
        <>
          <StepRow label="radius m" value={rig.dynamics.bodyRadiusMeters} step={0.05} min={0.1} max={2}
            onSet={(bodyRadiusMeters) => patch({ dynamics: { ...rig.dynamics!, bodyRadiusMeters } })} />
          <StepRow label="bounce" value={rig.dynamics.restitution} step={0.05} min={0} max={1}
            onSet={(restitution) => patch({ dynamics: { ...rig.dynamics!, restitution } })} />
        </>
      ) : null}
    </C.HW_Section>
  );
}
