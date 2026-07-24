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
import { useEffect, useState } from 'react';
import { C, accentFor } from '../workspace.cls';
import {
  describePropRig,
  LOOT_CATEGORIES,
  CONTAINER_ACCESS,
  type PropRig,
  type CoverClass,
} from '../../../runtime/skeleton';
import type { ModelFacePurpose, ModelLiveMaterial, ModelTextureSlot } from '../data/types';
import type { LightRig, V3 } from '../model/editMesh';
import { createTextureSlotFromSelection } from '../model/modelTextureSlotAuthoring';
import { MODEL_LIGHT_TUNING, newModelLight, normalizeModelLights } from '../model/modelLights';
import { REGION_MATERIALS } from '../render3d/regionFormula';

const host = globalThis as any;

// Enable-time defaults, mirroring the old prop table's common rows (a junk
// container searched in 3s with a coin-flip fill; a 0.45m chair; a kickable
// trash-can body). All editable the moment the capability is on.
const DEFAULT_CONTAINER: NonNullable<PropRig['container']> = { slots: 2, lootCategory: 'junk', access: 'open', searchSeconds: 3, spawnFillChance: 0.5 };
const DEFAULT_SEAT: NonNullable<PropRig['seat']> = { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 };
const DEFAULT_DYNAMICS: NonNullable<PropRig['dynamics']> = { bodyRadiusMeters: 0.3, restitution: 0.4 };

const COVER_CYCLE: (CoverClass | undefined)[] = [undefined, 'soft', 'hard'];
const FACE_PURPOSES: readonly ModelFacePurpose[] = ['material', 'screen', 'flora'];
const LIGHT_COLORS = ['#ffd27d', '#ffffff', '#ff8a5b', '#8fc7ff', '#9fffc5', '#d7a6ff'] as const;

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

export default function RigSection(props: {
  rig: PropRig;
  onChange: (rig: PropRig) => void;
  textureSlots: ModelTextureSlot[];
  onTextureSlotsChange: (slots: ModelTextureSlot[]) => void;
  onTextureMembershipChanged: (message: string, dirty?: boolean) => void;
  lights: LightRig[];
  onLightsChange: (lights: LightRig[]) => void;
}) {
  const { rig } = props;
  const [selectedLightId, setSelectedLightId] = useState<string | null>(props.lights[0]?.id ?? null);
  useEffect(() => {
    if (selectedLightId && props.lights.some((light) => light.id === selectedLightId)) return;
    setSelectedLightId(props.lights[0]?.id ?? null);
  }, [props.lights, selectedLightId]);
  const patch = (part: Partial<PropRig>) => props.onChange({ ...rig, ...part });
  const addTextureSlot = (purpose: ModelFacePurpose) => {
    const result = createTextureSlotFromSelection(
      props.textureSlots,
      (index) => Number(host.__mesh_texture_slot_assign?.(index) ?? 0),
      { purpose },
    );
    if (!result.slot) {
      props.onTextureMembershipChanged('Select one or more faces in Face mode before adding a texture role', false);
      return;
    }
    props.onTextureSlotsChange([...result.slots]);
    props.onTextureMembershipChanged(
      `created ${result.slot.label} from ${result.assignedFaces} selected face${result.assignedFaces === 1 ? '' : 's'}`,
    );
  };
  const renameTextureSlot = (index: number, label: string) => props.onTextureSlotsChange(
    props.textureSlots.map((slot, at) => at === index ? { ...slot, label } : slot),
  );
  const cycleTexturePurpose = (index: number) => props.onTextureSlotsChange(
    props.textureSlots.map((slot, at) => {
      if (at !== index) return slot;
      const current = slot.purpose ?? 'material';
      const purpose = cycleNext(FACE_PURPOSES, current);
      return { ...slot, ...(purpose === 'material' ? { purpose: undefined } : { purpose }) };
    }),
  );
  const assignTextureSlot = (index: number) => {
    const changed = Number(host.__mesh_texture_slot_assign?.(index) ?? 0);
    props.onTextureMembershipChanged(changed > 0
      ? `assigned ${changed} face${changed === 1 ? '' : 's'} to ${props.textureSlots[index]?.label ?? 'texture role'}`
      : 'Texture role needs selected faces in Face mode');
  };
  const selectTextureSlot = (index: number) => {
    const selected = Number(host.__mesh_texture_slot_select?.(index) ?? 0);
    props.onTextureMembershipChanged(selected > 0
      ? `selected ${selected} triangle${selected === 1 ? '' : 's'} in ${props.textureSlots[index]?.label ?? 'texture role'}`
      : `${props.textureSlots[index]?.label ?? 'Texture role'} has no faces`, false);
  };
  const removeTextureSlot = (index: number) => {
    host.__mesh_texture_slot_remove?.(index);
    props.onTextureSlotsChange(props.textureSlots.filter((_, at) => at !== index));
  };
  // ── Live material binding (req_3397): a slot wearing a liveMaterial renders
  // its faces as one continuous animated field (object-space domain) instead of
  // the painted atlas — the lavalamp's goo. Type a material name to bind; the
  // first case-insensitive match in the surface catalog wins. Empty text
  // returns the slot to paint.
  const liveMaterialLabel = (slot: ModelTextureSlot): string => {
    if (!slot.liveMaterial) return '';
    return REGION_MATERIALS.find((m) => m.fn === slot.liveMaterial!.fn)?.name ?? slot.liveMaterial.fn;
  };
  const patchLiveMaterial = (index: number, next: ModelLiveMaterial | undefined) => props.onTextureSlotsChange(
    props.textureSlots.map((slot, at) => {
      if (at !== index) return slot;
      const { liveMaterial: _drop, ...rest } = slot;
      return next ? { ...rest, liveMaterial: next } : rest;
    }),
  );
  const typeLiveMaterial = (index: number, text: string) => {
    const query = text.trim().toLowerCase();
    if (!query) {
      patchLiveMaterial(index, undefined);
      return;
    }
    const match = REGION_MATERIALS.find((m) => m.name.toLowerCase().includes(query) || m.fn.includes(query.replace(/[\s-]+/g, '_')));
    if (!match) return; // keep the current binding until the query resolves
    const current = props.textureSlots[index]?.liveMaterial;
    if (current?.fn === match.fn) return;
    patchLiveMaterial(index, { fn: match.fn, variant: 0, ...(current?.scale ? { scale: current.scale } : {}) });
  };
  const cycleLiveVariant = (index: number) => {
    const slot = props.textureSlots[index];
    if (!slot?.liveMaterial) return;
    const mat = REGION_MATERIALS.find((m) => m.fn === slot.liveMaterial!.fn);
    const count = Math.max(1, mat?.variantLabels.length ?? 1);
    patchLiveMaterial(index, { ...slot.liveMaterial, variant: ((slot.liveMaterial.variant ?? 0) + 1) % count });
  };
  const clearSelectedTextureSlots = () => {
    const changed = Number(host.__mesh_texture_slot_clear?.() ?? 0);
    props.onTextureMembershipChanged(changed > 0
      ? `cleared texture roles from ${changed} selected face${changed === 1 ? '' : 's'}`
      : 'Clear needs selected rigged faces in Face mode');
  };
  const addLight = () => {
    if (props.lights.length >= MODEL_LIGHT_TUNING.maxPerModel) return;
    const light = newModelLight(props.lights);
    props.onLightsChange([...props.lights, light]);
    setSelectedLightId(light.id);
  };
  const selectedLight = props.lights.find((light) => light.id === selectedLightId) ?? null;
  const editLight = (patch: Partial<LightRig>) => {
    if (!selectedLight) return;
    props.onLightsChange(props.lights.map((light) => light.id === selectedLight.id ? { ...light, ...patch } : light));
  };
  const editLightVector = (field: 'position' | 'dir', axis: 0 | 1 | 2, value: number) => {
    if (!selectedLight) return;
    const fallback: V3 = field === 'position' ? [0, 0, 0] : [0, -1, 0];
    const next = [...(selectedLight[field] ?? fallback)] as V3;
    next[axis] = value;
    editLight({ [field]: next });
  };
  const removeSelectedLight = () => {
    if (!selectedLight) return;
    const next = props.lights.filter((light) => light.id !== selectedLight.id);
    props.onLightsChange(next);
    setSelectedLightId(next[0]?.id ?? null);
  };
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('warning') }} />
        <C.HW_SectionTitle style={{ color: accentFor('warning') }}>RIG</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>{describePropRig(rig)}</C.HW_KeyText>
      </C.HW_SectionHead>

      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('active') }} />
        <C.HW_SectionTitle style={{ color: accentFor('active') }}>FACE RIGS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_OvBtn tooltip="rig selected faces as a material surface" onPress={() => addTextureSlot('material')}><C.HW_OvBtnText>M</C.HW_OvBtnText></C.HW_OvBtn>
        <C.HW_OvBtn tooltip="rig selected faces as a live screen" onPress={() => addTextureSlot('screen')}><C.HW_OvBtnText>S</C.HW_OvBtnText></C.HW_OvBtn>
        <C.HW_OvBtn tooltip="rig selected faces as a flora-paintable surface" onPress={() => addTextureSlot('flora')}><C.HW_OvBtnText>F</C.HW_OvBtnText></C.HW_OvBtn>
      </C.HW_SectionHead>
      {props.textureSlots.map((slot, index) => (
        <C.HW_TextureRole key={slot.id}>
          <C.HW_TextureRoleNameRow>
            <C.HW_RenameInput value={slot.label} onChange={(label: string) => renameTextureSlot(index, label)} />
            <C.HW_OvBtn tooltip="remove this role and return its faces to paint" onPress={() => removeTextureSlot(index)}><C.HW_OvBtnText>×</C.HW_OvBtnText></C.HW_OvBtn>
          </C.HW_TextureRoleNameRow>
          <C.HW_TextureRoleActionRow>
            <C.HW_VerbPrimary tooltip="cycle this face rig between material, screen, and flora surface" onPress={() => cycleTexturePurpose(index)}>
              <C.HW_VerbText>{(slot.purpose ?? 'material').toUpperCase()}</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbPrimary tooltip="select every face rigged to this role" onPress={() => selectTextureSlot(index)}>
              <C.HW_VerbText>select faces</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbPrimary tooltip="assign the selected authored faces to this role" onPress={() => assignTextureSlot(index)}>
              <C.HW_VerbText>assign selected</C.HW_VerbText>
            </C.HW_VerbPrimary>
          </C.HW_TextureRoleActionRow>
          <C.HW_ReadRow>
            <C.HW_FormLabel>live</C.HW_FormLabel>
            <C.HW_RenameInput value={liveMaterialLabel(slot)} placeholder="type a material — e.g. lava plasma" onChange={(text: string) => typeLiveMaterial(index, text)} />
            {slot.liveMaterial ? (
              <C.HW_OvBtn tooltip="return this role's faces to the painted atlas" onPress={() => patchLiveMaterial(index, undefined)}><C.HW_OvBtnText>×</C.HW_OvBtnText></C.HW_OvBtn>
            ) : <C.HW_OvResetIdle />}
          </C.HW_ReadRow>
          {slot.liveMaterial ? (
            <>
              <CycleRow
                label="motion"
                value={REGION_MATERIALS.find((m) => m.fn === slot.liveMaterial!.fn)?.variantLabels[slot.liveMaterial.variant ?? 0] ?? `variant ${slot.liveMaterial.variant ?? 0}`}
                tooltip="cycle the material's variant"
                onNext={() => cycleLiveVariant(index)}
              />
              <StepRow label="scale" value={slot.liveMaterial.scale ?? 1} step={0.25} min={0.25} max={8}
                onSet={(scale) => patchLiveMaterial(index, { ...slot.liveMaterial!, scale })} />
            </>
          ) : null}
        </C.HW_TextureRole>
      ))}
      {props.textureSlots.length === 0 ? (
        <C.HW_ReadRow>
          <C.HW_ReadValue>select faces, then M / S / F</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
      {props.textureSlots.length > 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>selected faces</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_OvToggle tooltip="return selected faces to the model's painted atlas" onPress={clearSelectedTextureSlots}>
            <C.HW_OvToggleText>use paint</C.HW_OvToggleText>
          </C.HW_OvToggle>
          <C.HW_OvResetIdle />
        </C.HW_ReadRow>
      ) : null}

      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: '#ffd27d' }} />
        <C.HW_SectionTitle style={{ color: '#ffd27d' }}>EMITTED LIGHTS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>{`${props.lights.length}/${MODEL_LIGHT_TUNING.maxPerModel}`}</C.HW_KeyText>
        <C.HW_OvBtn tooltip="add a model-local spotlight" onPress={addLight}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
      </C.HW_SectionHead>
      {props.lights.map((light) => {
        const active = light.id === selectedLightId;
        const Button = active ? C.HW_OvToggleOn : C.HW_OvToggle;
        const Label = active ? C.HW_OvToggleTextOn : C.HW_OvToggleText;
        return (
          <C.HW_ReadRow key={light.id}>
            <C.HW_FormLabel>{light.id}</C.HW_FormLabel>
            <C.HW_Spacer />
            <C.HW_Swatch style={{ backgroundColor: light.color }} />
            <Button tooltip="edit this emitted light" onPress={() => setSelectedLightId(light.id)}><Label>{light.kind === 'spot' ? 'spot' : 'bulb'}</Label></Button>
            <C.HW_OvResetIdle />
          </C.HW_ReadRow>
        );
      })}
      {props.lights.length === 0 ? (
        <C.HW_ReadRow><C.HW_ReadValue>none — add a point or spot emitter</C.HW_ReadValue></C.HW_ReadRow>
      ) : null}
      {selectedLight ? (
        <>
          <CycleRow
            label="type"
            value={selectedLight.kind === 'spot' ? 'spot' : 'bulb'}
            tooltip="Spot is aimed and may cast a shadow; bulb shines in every direction"
            onNext={() => editLight(selectedLight.kind === 'spot'
              ? { kind: 'point', dir: undefined, spread: undefined, castsShadow: undefined }
              : { kind: 'spot', dir: [0, -1, 0], spread: MODEL_LIGHT_TUNING.defaultConeDegrees, castsShadow: true })}
          />
          <CycleRow
            label="color"
            value={selectedLight.color}
            tooltip="cycle the emitter color"
            onNext={() => editLight({ color: cycleNext(LIGHT_COLORS, selectedLight.color as typeof LIGHT_COLORS[number]) })}
          />
          {props.textureSlots.some((slot) => slot.liveMaterial) ? (
            <CycleRow
              label="glow from"
              value={selectedLight.colorFrom
                ? (props.textureSlots.find((slot) => slot.id === selectedLight.colorFrom)?.label ?? selectedLight.colorFrom)
                : 'fixed color'}
              tooltip="follow a live material's palette — the lamp glows with its goo — or keep the fixed color"
              onNext={() => {
                const liveIds = props.textureSlots.filter((slot) => slot.liveMaterial).map((slot) => slot.id);
                const cycle: (string | undefined)[] = [undefined, ...liveIds];
                const at = selectedLight.colorFrom ? cycle.indexOf(selectedLight.colorFrom) : 0;
                const next = cycle[(at + 1) % cycle.length];
                editLight({ colorFrom: next });
              }}
            />
          ) : null}
          {(['x', 'y', 'z'] as const).map((label, axis) => (
            <StepRow key={`light-pos-${label}`} label={`pos ${label}`} value={selectedLight.position[axis]} step={0.25} min={-1000} max={1000} onSet={(value) => editLightVector('position', axis as 0 | 1 | 2, value)} />
          ))}
          {selectedLight.kind === 'spot' ? (['x', 'y', 'z'] as const).map((label, axis) => (
            <StepRow key={`light-dir-${label}`} label={`aim ${label}`} value={(selectedLight.dir ?? [0, -1, 0])[axis]} step={0.1} min={-1} max={1} onSet={(value) => editLightVector('dir', axis as 0 | 1 | 2, value)} />
          )) : null}
          <StepRow label="bright" value={selectedLight.intensity} step={0.5} min={MODEL_LIGHT_TUNING.minIntensity} max={MODEL_LIGHT_TUNING.maxIntensity} onSet={(intensity) => editLight({ intensity })} />
          <StepRow label="reach" value={selectedLight.range} step={0.5} min={MODEL_LIGHT_TUNING.minRangeMeters} max={MODEL_LIGHT_TUNING.maxRangeMeters} fmt={(value) => `${value.toFixed(1)}m`} onSet={(range) => editLight({ range })} />
          {selectedLight.kind === 'spot' ? (
            <>
              <StepRow label="cone" value={selectedLight.spread ?? MODEL_LIGHT_TUNING.defaultConeDegrees} step={1} min={MODEL_LIGHT_TUNING.minConeDegrees} max={MODEL_LIGHT_TUNING.maxConeDegrees} fmt={(value) => `${Math.round(value)}°`} onSet={(spread) => editLight({ spread })} />
              <ToggleRow label="shadow" on={selectedLight.castsShadow !== false} tooltip="let this spotlight own a shadow map when available" onToggle={() => editLight({ castsShadow: selectedLight.castsShadow === false })} />
            </>
          ) : null}
          <C.HW_ReadRow>
            <C.HW_FormLabel>selected light</C.HW_FormLabel>
            <C.HW_Spacer />
            <C.HW_OvToggle tooltip="remove this emitted light" onPress={removeSelectedLight}><C.HW_OvToggleText>remove</C.HW_OvToggleText></C.HW_OvToggle>
            <C.HW_OvResetIdle />
          </C.HW_ReadRow>
        </>
      ) : null}

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
