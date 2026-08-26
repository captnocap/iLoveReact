import { useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { listDir } from '../../../runtime/hooks/fs';
import type { ModelPackage, ModelPart } from '../data/types';
import { resolvePackageDir } from '../data/modelPackageStore';
import { loadGameTargets, type GameTarget, type GameTargetField } from '../data/gameTarget';
import type { ModelFocusBridge } from '../stage/ModelView';
import {
  BLUEPRINT_PROFILE_SCHEMAS,
  type AudioEventEntry,
  type BlueprintAttachment,
  type BlueprintFieldSchema,
  type BlueprintProfileRef,
  type BlueprintScope,
  type BlueprintTable,
} from '../model/blueprintTable';
import {
  BLUEPRINT_PRESETS,
  addBlueprintProfiles,
  blueprintAttachment,
  profileAdditions,
  setBlueprintAttachmentField,
  setBlueprintExtensionField,
  type BlueprintPresetName,
  type BlueprintProfileAddition,
} from '../model/blueprintAuthoring';
import { BLUEPRINT_AUDIO_EVENT_TAGS } from '../model/blueprintAudioTags';
import { AssignCell, CellRow, NumberCell } from './EditCell';
import PresetSection from './PresetSection';
import ReadOnlySection from './ReadOnlySection';
import { blueprintApplicationReport } from '../../../runtime/game/blueprintAdapters';

const MAX_SEMANTIC_TABLE_BYTES = 1024 * 1024;
const TAG_CHOICES = ['common', 'rare', 'quest', 'carryable', 'equippable'];

type Picker = Readonly<{
  title: string;
  options: readonly string[];
  active?: string;
  onPick: (value: string) => void;
}> | null;

const refKey = (profile: BlueprintProfileRef) => `${profile.id}@${profile.version}`;

/**
 * Every field an extension carries, flattened to `path → value` rows.
 *
 * The first cut printed a byte count, then a field COUNT with the names cut off
 * at an ellipsis — which is the same hiding, just further in. There is no reason
 * for any of it to be hidden: this is the model's own data, the panel already
 * has it in memory, and the only thing "opaque" means here is that the EDITOR
 * does not validate it. So all of it renders, nested paths and all (req_4776).
 */
function extensionFieldRows(value: unknown, prefix = ''): string[][] {
  if (value === null || value === undefined) return [[prefix || 'value', 'null']];
  if (Array.isArray(value)) {
    if (value.length === 0) return [[prefix || 'value', 'empty list']];
    return value.flatMap((entry, index) => extensionFieldRows(entry, `${prefix}[${index}]`));
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return [[prefix || 'value', 'no fields']];
    return keys.flatMap((key) => extensionFieldRows(
      (value as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
    ));
  }
  return [[prefix || 'value', String(value)]];
}

function targetAddition(target: GameTarget, profile: BlueprintProfileRef): BlueprintProfileAddition {
  const standard = BLUEPRINT_PROFILE_SCHEMAS.find((schema) => schema.id === profile.id && schema.version === profile.version);
  if (standard) return { profile, lane: standard.lane };
  const declared = target.fields.find((field) => field.profile?.id === profile.id && field.profile.version === profile.version);
  return { profile, lane: declared?.lane === 'physics' ? 'physics' : 'stats' };
}

function attachmentValue(attachment: BlueprintAttachment | null, field: BlueprintFieldSchema): unknown {
  const value = attachment?.[field.id];
  return field.kind === 'physical' && value && typeof value === 'object'
    ? (value as { value?: unknown }).value
    : value;
}

function targetFieldSchema(field: GameTargetField): BlueprintFieldSchema {
  return {
    id: field.key,
    label: field.label,
    kind: field.kind,
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
    ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
    ...(field.scrubStep === undefined ? {} : { scrubStep: field.scrubStep }),
    ...(field.values ? { values: field.values } : {}),
  };
}

export default function BlueprintStatsPanel(props: {
  bridge: ModelFocusBridge | null;
  model: ModelPackage;
  activePart: ModelPart | null;
  onStatus: (message: string) => void;
  onBlueprintRemoved: () => void;
}) {
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState<string>('Custom');
  const [scopeKind, setScopeKind] = useState<'document' | 'object'>('document');
  const [picker, setPicker] = useState<Picker>(null);
  const catalog = useMemo(loadGameTargets, []);
  const packageDir = resolvePackageDir(props.model.kind, props.model.id);
  const audioClips = useMemo(() => packageDir
    ? listDir(`${packageDir}/audio`).filter((name) => name.toLowerCase().endsWith('.wav')).map((name) => name.slice(0, -4)).sort()
    : [], [packageDir]);
  const selectedTarget = preset.startsWith('target: ')
    ? catalog.targets.find((target) => `target: ${target.name}` === preset) ?? null
    : null;
  const scope: BlueprintScope = scopeKind === 'object' && props.activePart
    ? { kind: 'object', objectId: props.activePart.id }
    : { kind: 'document' };
  const blueprint = props.bridge?.blueprint ?? null;

  const commit = (next: BlueprintTable, message: string) => {
    const result = props.bridge?.commitBlueprint(next);
    props.onStatus(result?.ok ? message : `Blueprint refused: ${result?.error ?? 'resident model unavailable'}`);
  };
  const selectPreset = (choice: string) => {
    setPreset(choice);
    setPresetOpen(false);
    if (!props.bridge) return props.onStatus('Blueprint unavailable: no resident model bridge');
    const target = catalog.targets.find((candidate) => `target: ${candidate.name}` === choice);
    const additions = target
      ? target.profiles.map((profile) => targetAddition(target, profile))
      : profileAdditions(BLUEPRINT_PRESETS[choice as BlueprintPresetName] ?? []);
    if (additions.length === 0) return;
    commit(addBlueprintProfiles(blueprint, additions, scope, target?.namespace), `${choice} profiles added at ${scope.kind} scope`);
  };
  const updateField = (addition: BlueprintProfileAddition, field: BlueprintFieldSchema, value: unknown, rubric?: string) => {
    const seeded = blueprint ?? addBlueprintProfiles(null, [addition], scope, selectedTarget?.namespace);
    const stored = field.kind === 'physical' && value !== undefined
      ? { value, unit: field.unit }
      : value;
    try {
      commit(setBlueprintAttachmentField(seeded, addition, scope, field.id, stored), `${field.label} updated`);
    } catch (error) {
      props.onStatus(`Blueprint refused: ${error instanceof Error ? error.message : String(error)}${rubric ? ` — ${rubric}` : ''}`);
    }
  };
  const choose = (title: string, options: readonly string[], active: string | undefined, onPick: (value: string) => void) =>
    setPicker({ title, options, active, onPick });

  const renderEnum = (addition: BlueprintProfileAddition, field: BlueprintFieldSchema, value: unknown, rubric?: string) => (
    <CellRow key={field.id} label={field.label} overridden={value !== undefined} onReset={value === undefined ? undefined : () => updateField(addition, field, undefined, rubric)}>
      {value === undefined ? (
        <AssignCell tooltip={rubric} onPress={() => choose(field.label, field.values ?? TAG_CHOICES, undefined, (picked) => updateField(addition, field, picked, rubric))} />
      ) : (
        <C.HW_SelectControl tooltip={rubric} onPress={() => choose(field.label, field.values ?? TAG_CHOICES, String(value), (picked) => updateField(addition, field, picked, rubric))}>
          <C.HW_FormValue>{String(value)}</C.HW_FormValue><C.HW_Spacer /><Icon name="ChevronDown" size={10} color={accentFor('textDim')} />
        </C.HW_SelectControl>
      )}
    </CellRow>
  );

  const renderField = (addition: BlueprintProfileAddition, attachment: BlueprintAttachment | null, field: BlueprintFieldSchema, rubric?: string) => {
    const value = attachmentValue(attachment, field);
    if (field.kind === 'enum' || field.kind === 'tags' || field.kind === 'boolean') {
      const schema = field.kind === 'boolean' ? { ...field, values: ['true', 'false'] } : field;
      const shown = field.kind === 'boolean' && value !== undefined ? String(value) : value;
      return renderEnum(addition, schema, shown, rubric);
    }
    if (field.kind === 'axles') {
      const axles = Array.isArray(value) ? value as any[] : [];
      return (
        <Col key={field.id}>
          <CellRow label={field.label} overridden={axles.length > 0} onReset={axles.length ? () => updateField(addition, field, undefined, rubric) : undefined}>
            {axles.length === 0 ? <AssignCell label="add front + rear…" tooltip={rubric} onPress={() => updateField(addition, field, [
              { id: 'front', position: 'front' }, { id: 'rear', position: 'rear' },
            ], rubric)} /> : <C.HW_ReadValue>{`${axles.length} axles`}</C.HW_ReadValue>}
          </CellRow>
          {axles.flatMap((axle, index) => ['driveBias', 'brakeBias', 'gripRating'].map((key) => {
            const axleValue = axle[key];
            return <CellRow key={`${axle.id}-${key}`} label={`${axle.id} ${key.replace('Rating', '')}`} overridden={axleValue !== undefined} onReset={axleValue === undefined ? undefined : () => {
              const next = axles.map((row, rowIndex) => rowIndex === index ? Object.fromEntries(Object.entries(row).filter(([entry]) => entry !== key)) : row);
              updateField(addition, field, next, rubric);
            }}>
              {axleValue === undefined ? <AssignCell onPress={() => {
                const next = axles.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: 0.5 } : row);
                updateField(addition, field, next, rubric);
              }} /> : <NumberCell value={Number(axleValue)} minimum={0} maximum={1} scrubStep={0.01} overridden onCommit={(next) => {
                const rows = axles.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: next } : row);
                updateField(addition, field, rows, rubric);
              }} />}
            </CellRow>;
          }))}
        </Col>
      );
    }
    if (field.kind === 'audioEvents') return null;
    const numeric = typeof value === 'number' ? value : null;
    return (
      <CellRow key={field.id} label={field.label} overridden={numeric !== null} onReset={numeric === null ? undefined : () => updateField(addition, field, undefined, rubric)}>
        {numeric === null ? (
          <AssignCell tooltip={rubric} onPress={() => updateField(addition, field, field.minimum ?? 0, rubric)} />
        ) : (
          <Row style={{ flexGrow: 1, minWidth: 0, alignItems: 'center', gap: 5 }}>
            <NumberCell
              value={numeric}
              minimum={field.minimum}
              maximum={field.maximum}
              scrubStep={field.scrubStep}
              overridden
              tooltip={rubric}
              onCommit={(next) => updateField(addition, field, field.id === 'maxStack' ? Math.max(1, Math.round(next)) : next, rubric)}
            />
            {field.unit ? <Text style={{ width: 34, fontSize: 9, color: accentFor('textDim'), fontFamily: 'monospace' }}>{field.unit}</Text> : null}
          </Row>
        )}
      </CellRow>
    );
  };

  const renderAudio = (addition: BlueprintProfileAddition, attachment: BlueprintAttachment | null) => {
    const events = ((attachment as any)?.events ?? {}) as Record<string, AudioEventEntry>;
    const setEvents = (next: Record<string, AudioEventEntry>) => updateField(addition, { id: 'events', label: 'Events', kind: 'audioEvents' }, next);
    const addEvent = (tag: string) => {
      if (!audioClips.length) return props.onStatus(`Add a .wav clip to ${packageDir ?? 'this package'}/audio first`);
      setEvents({ ...events, [tag]: { clips: [audioClips[0]!], mode: 'replace' } });
    };
    return (
      <C.HW_Section key={refKey(addition.profile)}>
        <C.HW_SectionHead><C.HW_AccentBar /><C.HW_SectionTitle>{addition.profile.id.toUpperCase()}</C.HW_SectionTitle><C.HW_Spacer /><C.HW_Tag><C.HW_TagText>{scope.kind}</C.HW_TagText></C.HW_Tag></C.HW_SectionHead>
        {Object.entries(events).map(([tag, event]) => (
          <CellRow key={tag} label={tag} overridden onReset={() => setEvents(Object.fromEntries(Object.entries(events).filter(([name]) => name !== tag)))}>
            <Row style={{ flexGrow: 1, minWidth: 0, gap: 4 }}>
              {/* The clip carries an authored NAME ("speaker squawk"); the mode
                  is one of three short words. Splitting the row evenly starves
                  the only half that can be long, so the clip takes two shares. */}
              <C.HW_SelectControl style={{ flexGrow: 2 }} tooltip="Pick package audio clip" onPress={() => choose('AUDIO CLIP', audioClips, event.clips[0], (clip) => setEvents({ ...events, [tag]: { ...event, clips: [clip] } }))}>
                <C.HW_FormValue>{event.clips.join(' + ')}</C.HW_FormValue>
              </C.HW_SelectControl>
              <C.HW_SelectControl tooltip="Layering policy" onPress={() => choose('AUDIO MODE', ['replace', 'layer', 'duck'], event.mode, (mode) => setEvents({ ...events, [tag]: { ...event, mode: mode as AudioEventEntry['mode'] } }))}>
                <C.HW_FormValue>{event.mode ?? 'replace'}</C.HW_FormValue>
              </C.HW_SelectControl>
            </Row>
          </CellRow>
        ))}
        <C.HW_ButtonRow><C.HW_VerbPrimary onPress={() => choose('EVENT TAG', BLUEPRINT_AUDIO_EVENT_TAGS.filter((tag) => !events[tag]), undefined, addEvent)}><C.HW_VerbText>ADD EVENT</C.HW_VerbText></C.HW_VerbPrimary></C.HW_ButtonRow>
      </C.HW_Section>
    );
  };

  const visibleProfiles = selectedTarget
    ? selectedTarget.profiles
    : blueprint?.profiles ?? [];
  const profileSections = visibleProfiles.map((profile) => {
    const standard = BLUEPRINT_PROFILE_SCHEMAS.find((schema) => schema.id === profile.id && schema.version === profile.version);
    const addition = selectedTarget ? targetAddition(selectedTarget, profile) : { profile, lane: standard?.lane ?? 'stats' as const };
    const attachment = blueprintAttachment(blueprint, addition.lane, profile, scope);
    if (profile.id === 'rj.core.audio') return renderAudio(addition, attachment);
    const targetFields = selectedTarget?.fields.filter((field) => field.lane !== 'extension' && field.profile && refKey(field.profile) === refKey(profile));
    const fields = targetFields ? targetFields.map(targetFieldSchema) : standard?.fields ?? [];
    return (
      <C.HW_Section key={refKey(profile)}>
        <C.HW_SectionHead><C.HW_AccentBar /><C.HW_SectionTitle>{profile.id.toUpperCase()}</C.HW_SectionTitle><C.HW_Spacer /><C.HW_Tag><C.HW_TagText>{scope.kind}</C.HW_TagText></C.HW_Tag></C.HW_SectionHead>
        {fields.map((field, index) => renderField(addition, attachment, field, targetFields?.[index]?.rubric))}
        {fields.length === 0 ? <C.HW_ReadRow><C.HW_FormLabel>profile</C.HW_FormLabel><C.HW_ReadValue>opaque · preserved</C.HW_ReadValue><C.HW_OvResetIdle /></C.HW_ReadRow> : null}
      </C.HW_Section>
    );
  });

  const extensionRows = Object.entries(blueprint?.extensions ?? {});
  const targetExtensionFields = selectedTarget?.fields.filter((field) => field.lane === 'extension') ?? [];
  const requiredMissing = selectedTarget?.fields.filter((field) => {
    if (!field.required) return false;
    if (field.lane === 'extension') return (blueprint?.extensions[field.extension! as string] as any)?.[field.key] === undefined;
    const addition = targetAddition(selectedTarget, field.profile!);
    return (blueprintAttachment(blueprint, addition.lane, field.profile!, scope) as any)?.[field.key] === undefined;
  }) ?? [];
  const applicationSummary = selectedTarget?.applicationConsumerId
    ? blueprintApplicationReport({ consumerId: selectedTarget.applicationConsumerId }).summary
    : null;

  return (
    <Col style={{ flexGrow: 1, minHeight: 0 }}>
      <ScrollView style={{ flexGrow: 1, minHeight: 0 }} showScrollbar>
        <PresetSection
          title="PROFILES" color="primary" active={preset}
          options={[...Object.keys(BLUEPRINT_PRESETS), ...catalog.targets.map((target) => `target: ${target.name}`)]}
          open={presetOpen} rows={catalog.invalid.map((row) => [`invalid ${row.file}`, row.error])}
          onPreset={() => setPresetOpen((open) => !open)} onOption={selectPreset}
        />
        <C.HW_Section>
          <C.HW_SectionHead><C.HW_AccentBar /><C.HW_SectionTitle>SCOPE</C.HW_SectionTitle></C.HW_SectionHead>
          <C.HW_ButtonRow>
            <C.HW_VerbPrimary onPress={() => setScopeKind('document')} style={scope.kind === 'document' ? { borderColor: accentFor('primary') } : undefined}><C.HW_VerbText>DOCUMENT</C.HW_VerbText></C.HW_VerbPrimary>
            <C.HW_VerbPrimary tooltip={props.activePart ? `Bind to ${props.activePart.name}` : 'Select a part in the Outliner first'} onPress={props.activePart ? () => setScopeKind('object') : undefined} style={scope.kind === 'object' ? { borderColor: accentFor('primary') } : undefined}><C.HW_VerbText>{`PART · ${props.activePart?.name ?? 'none'}`}</C.HW_VerbText></C.HW_VerbPrimary>
          </C.HW_ButtonRow>
        </C.HW_Section>
        {profileSections}
        {targetExtensionFields.length ? (
          <C.HW_Section>
            <C.HW_SectionHead><C.HW_AccentBar /><C.HW_SectionTitle>{`${selectedTarget!.namespace.toUpperCase()} EXTENSION`}</C.HW_SectionTitle></C.HW_SectionHead>
            {targetExtensionFields.map((targetField) => {
              const field = targetFieldSchema(targetField);
              const value = (blueprint?.extensions[selectedTarget!.namespace] as any)?.[field.id];
              const write = (next: unknown) => {
                const base = blueprint ?? addBlueprintProfiles(null, selectedTarget!.profiles.map((profile) => targetAddition(selectedTarget!, profile)), scope, selectedTarget!.namespace);
                try { commit(setBlueprintExtensionField(base, selectedTarget!.namespace, field.id, next), `${field.label} updated`); }
                catch (error) { props.onStatus(`Blueprint refused: ${error instanceof Error ? error.message : String(error)}`); }
              };
              if (field.kind === 'enum' || field.kind === 'tags' || field.kind === 'boolean') {
                const options = field.kind === 'boolean' ? ['true', 'false'] : field.values ?? TAG_CHOICES;
                return <CellRow key={field.id} label={field.label} overridden={value !== undefined} onReset={value === undefined ? undefined : () => write(undefined)}>{value === undefined ? <AssignCell tooltip={targetField.rubric} onPress={() => choose(field.label, options, undefined, (picked) => write(field.kind === 'boolean' ? picked === 'true' : picked))} /> : <C.HW_SelectControl tooltip={targetField.rubric} onPress={() => choose(field.label, options, String(value), (picked) => write(field.kind === 'boolean' ? picked === 'true' : picked))}><C.HW_FormValue>{String(value)}</C.HW_FormValue></C.HW_SelectControl>}</CellRow>;
              }
              return <CellRow key={field.id} label={field.label} overridden={typeof value === 'number'} onReset={typeof value === 'number' ? () => write(undefined) : undefined}>{typeof value === 'number' ? <NumberCell value={value} minimum={field.minimum} maximum={field.maximum} scrubStep={field.scrubStep} overridden tooltip={targetField.rubric} onCommit={write} /> : <AssignCell tooltip={targetField.rubric} onPress={() => write(field.minimum ?? 0)} />}</CellRow>;
            })}
          </C.HW_Section>
        ) : extensionRows.length ? (
          // One section PER NAMESPACE, titled and shaped exactly like the
          // rj.core.* profile sections above it — because that is what it is:
          // a namespace of fields on this model. Calling it "vendor data" and
          // summarising it to a count made the user's own car model look like
          // somebody else's secret (req_4776).
          <>
            {extensionRows.map(([namespace, value]) => {
              const fields = extensionFieldRows(value);
              return (
                <C.HW_Section key={namespace}>
                  <C.HW_SectionHead>
                    <C.HW_AccentBar />
                    <C.HW_SectionTitle>{namespace.toUpperCase()}</C.HW_SectionTitle>
                    <C.HW_Spacer />
                    <C.HW_Tag style={{ backgroundColor: accentFor('textDim') }}>
                      <C.HW_TagText>as written</C.HW_TagText>
                    </C.HW_Tag>
                  </C.HW_SectionHead>
                  {fields.map(([field, shown]) => (
                    <C.HW_ReadRow
                      key={field}
                      tooltip={`${namespace}.${field} — stored and re-saved exactly as written. This editor does not read, validate, or change it; the tool that wrote it owns its meaning.`}
                    >
                      <C.HW_FormLabel>{field ?? ''}</C.HW_FormLabel>
                      <C.HW_Spacer />
                      <C.HW_ReadValue>{shown ?? ''}</C.HW_ReadValue>
                      <C.HW_OvResetIdle />
                    </C.HW_ReadRow>
                  ))}
                </C.HW_Section>
              );
            })}
          </>
        ) : null}
        {blueprint ? <C.HW_ButtonRow><C.HW_VerbPrimary tooltip="Explicitly remove the whole blueprint; ordinary Save will receive a one-shot removal capability" onPress={() => {
          const result = props.bridge?.commitBlueprint(null);
          if (result?.ok) { props.onBlueprintRemoved(); props.onStatus('Blueprint removed from LIVE; Save will persist this explicit removal'); }
          else props.onStatus(`Blueprint removal refused: ${result?.error ?? 'resident model unavailable'}`);
        }}><C.HW_VerbText>REMOVE BLUEPRINT</C.HW_VerbText></C.HW_VerbPrimary></C.HW_ButtonRow> : null}
      </ScrollView>
      <ReadOnlySection title="BLUEPRINT FACTS" color="primary" rows={[
        ['profiles', String(blueprint?.profiles.length ?? 0)],
        ['attachments', String((blueprint?.stats.length ?? 0) + (blueprint?.physics.length ?? 0))],
        ['table bytes', `${props.bridge?.blueprintStatus.tableBytes ?? 0} / ${MAX_SEMANTIC_TABLE_BYTES}`],
        ['validator', props.bridge?.blueprintStatus.verdict ?? 'unavailable'],
        ...(selectedTarget ? [['export check', requiredMissing.length ? `${requiredMissing.length} required missing` : 'consumable']] : []),
        ...(applicationSummary ? [
          ['applied', String(applicationSummary.adopted)],
          ['normalized', String(applicationSummary.normalized)],
          ['ignored', String(applicationSummary.ignoredByPolicy)],
          ['preserved', String(applicationSummary.unknownPreserved)],
          ['defaulted', String(applicationSummary.defaulted)],
        ] : []),
      ]} />
      {picker ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
          <Pressable onPress={() => setPicker(null)} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
          <C.HW_SelectMenu style={{ position: 'absolute', left: 10, top: 86, right: 10, marginLeft: 0, marginRight: 0, maxHeight: 260 }}>
            <C.HW_ReadRow><C.HW_FormLabel>{picker.title}</C.HW_FormLabel></C.HW_ReadRow>
            {picker.options.map((option) => <C.HW_SelectOption key={option} onPress={() => { picker.onPick(option); setPicker(null); }}><C.HW_FormValue>{option}</C.HW_FormValue><C.HW_Spacer />{picker.active === option ? <Icon name="Check" size={10} color={accentFor('primary')} /> : null}</C.HW_SelectOption>)}
          </C.HW_SelectMenu>
        </Box>
      ) : null}
    </Col>
  );
}
