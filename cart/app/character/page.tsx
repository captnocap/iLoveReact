// Character creator — studio surface.
//
// The persisted substrate is still a direct set of character fields,
// but the route presents it as a non-linear station workbench instead
// of one massive form. Every station is a direct jump target; nothing
// is gated behind a wizard path.
//
// Every theme-touching surface is a classifier from
// `cart/component-gallery/components.cls.ts`. No hex literals — all
// colors flow through `theme:*` tokens via the classifiers, so the
// page re-themes for free when the active gallery theme variant flips.
//
// Layout:
//   Left rail — direct station jumps.
//   Center workbench — the active station's controls.
//   Right preview — avatar + live character readout.

import { useRef, useState } from 'react';
import { Box, Col, Row, ScrollView, Pressable, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { Tooltip } from '@reactjit/runtime/tooltip/Tooltip';
import { classifiers as S } from '@reactjit/core';
import { Avatar } from '@reactjit/runtime/avatar';
import { CharacterProvider, useCharacter, type CharacterRow } from './state';
import { useAnimationTimeline } from '../anim';
import { askAssistant } from '../chat/store';
import { AxisReadout, type AxisReadoutBar } from '../gallery/components/controls-specimen/AxisReadout';
import { MeterSlider } from '../gallery/components/controls-specimen/MeterSlider';
import { BlockFaces, archetypeForWorker } from '../gallery/components/block-faces/BlockFaces';
import { BlockFace3D } from '../gallery/components/block-faces/BlockFace3D';
import { PopulationPyramid } from '../gallery/components/population-pyramid/PopulationPyramid';
import { Venn, type VennDatum } from '../gallery/components/venn/Venn';
import { useGradientWave, useScramble } from '../gallery/components/animated-text/useAnimatedText';
import type { Worker, WorkerLifecycle } from '../gallery/data/core/worker';
import {
  ARCHETYPES,
  BOUNDARY_RULES,
  CORRECTIONS,
  DIALS,
  DEFAULT_AVATAR,
  INITIATIVES,
  KNOWLEDGE_SPECIALIZATIONS,
  QUIRKS,
  RELATIONSHIP_REGISTERS,
  STAKE_PROFILES,
  STANCES,
  TASK_DOMAINS,
  USER_STATES,
  type CatalogOption,
} from './catalog';

// ── Animation helpers ────────────────────────────────────────────────
//
// Two layers per the app.md "Animation principles":
//   • Page-level Fade — route content swap inside the stable shell.
//   • Per-section Spring stagger — each Section tile springs in (opacity
//     0→1 + small marginTop slide) eased by easeOutBack, with a 60ms
//     stagger between siblings. Same envelope as cart/app/page.tsx's
//     home-entry sequence; one master `useAnimationTimeline` drives every
//     range to keep the RAF loop count at 1.

const SECTION_DUR_MS = 380;     // one section's spring entry duration
const SECTION_SLIDE_PX = 12;    // how far each section rises during entry
const HEAD_DUR_MS = 300;        // page heading fade
const PAGE_FADE_MS = 350;       // content-area fade-in

function Stagger({ progress, children }: { progress: number; children: any }) {
  // Spring envelope: opacity ramps with progress; the section starts
  // SECTION_SLIDE_PX below its resting position and rises into place.
  return (
    <Box style={{
      width: '100%',
      opacity: progress,
      marginTop: (1 - progress) * SECTION_SLIDE_PX,
    }}>
      {children}
    </Box>
  );
}

// ── Small primitives ──────────────────────────────────────────────────

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const Tile = active ? S.AppTraitChipActive : S.AppTraitChip;
  const Text_ = active ? S.AppTraitChipTextActive : S.AppTraitChipText;
  return (
    <Tile onPress={onPress}>
      <Text_>{label}</Text_>
    </Tile>
  );
}

function CharacterCard({ children, style }: { children: any; style?: any }) {
  return (
    <S.Card style={{ width: '100%', alignItems: 'stretch', ...style }}>
      {children}
    </S.Card>
  );
}

type MoreOptionKind = 'archetype' | 'quirks' | 'stance' | 'boundaries';

function promptForMoreOptions(kind: MoreOptionKind): string {
  const optionLines =
    kind === 'archetype'
      ? ARCHETYPES.map((a) => `- ${a.label}: ${a.description}`).join('\n')
      : kind === 'quirks'
        ? QUIRKS.map((q) => `- ${q.label}: ${q.description}`).join('\n')
        : kind === 'stance'
          ? [
              'Relationship stance:',
              ...STANCES.map((s) => `- ${s.label}`),
              'Initiative profile:',
              ...INITIATIVES.map((i) => `- ${i.label}`),
              'Correction style:',
              ...CORRECTIONS.map((c) => `- ${c.label}`),
            ].join('\n')
          : BOUNDARY_RULES.map((b) => `- ${b.label}: ${b.description}`).join('\n');

  const noun =
    kind === 'archetype'
      ? 'assistant character archetypes'
      : kind === 'quirks'
        ? 'assistant voice quirks'
        : kind === 'stance'
          ? 'relationship, initiative, and correction stance options'
          : 'portable assistant boundary rules';

  return [
    `Generate more ${noun} for the /character creator.`,
    '',
    'Current committed options:',
    optionLines,
    '',
    'Freestyle beyond this list. Return an interactive chat-loom surface with 6 to 10 fresh options as <Btn> choices. Keep each label short, make every option distinct, and include one sentence explaining when a user should pick it.',
    'For each <Btn>, set reply to a concise instruction that says which option was selected and asks you to translate it into the closest current character controls if it is not already a committed option.',
  ].join('\n');
}

function MoreOptionsButton({ kind }: { kind: MoreOptionKind }) {
  const [busy, setBusy] = useState(false);
  const label =
    kind === 'archetype'
      ? 'More archetypes'
      : kind === 'quirks'
        ? 'More quirks'
        : kind === 'stance'
          ? 'More stances'
          : 'More boundaries';

  const onPress = () => {
    if (busy) return;
    setBusy(true);
    void askAssistant(promptForMoreOptions(kind))
      .catch((e: any) => {
        console.log('[character] more options failed: ' + (e?.message ?? String(e)));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Tooltip label="Ask the assistant to generate fresh choices for this station." side="top" delayMs={250}>
      <S.ButtonOutline onPress={onPress}>
        <S.ButtonOutlineLabel>{busy ? 'Asking...' : label}</S.ButtonOutlineLabel>
      </S.ButtonOutline>
    </Tooltip>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onPick,
}: {
  options: { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
}) {
  return (
    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <Chip key={o.id} label={o.label} active={o.id === value} onPress={() => onPick(o.id)} />
      ))}
    </Row>
  );
}

function ArchetypeCard({
  label,
  description,
  active,
  onPress,
}: {
  label: string;
  description: string;
  active: boolean;
  onPress: () => void;
}) {
  const Tile = active ? S.AppProviderTileActive : S.AppProviderTile;
  const Title_ = active ? S.AppProviderTileTitleActive : S.AppProviderTileTitle;
  return (
    <Box style={{ width: '25%', padding: 5 }}>
      <Tile
        onPress={onPress}
        style={{ width: '100%', minHeight: 96, padding: 'theme:spaceX5' }}
      >
        <Col style={{ gap: 4 }}>
          <Title_>{label}</Title_>
          <S.AppProviderTileSubtitle>{description}</S.AppProviderTileSubtitle>
        </Col>
      </Tile>
    </Box>
  );
}

// ── Discrete slider — 11 cells (0.0..1.0 in 0.1 steps) ────────────────
//
// Reuses the AppStepCube classifiers from the onboarding step indicator —
// same visual language ("the discrete value at index N is here") repeated
// per axis.

const SLIDER_STEPS = 11;
const FEATURED_DIAL_IDS = [
  'direct_diplomatic',
  'warm_cool',
  'pushback_compliance',
  'stakes_sensitivity',
];

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pct(n: number): number {
  return Math.round(clamp01(n) * 100);
}

function dialValue(character: CharacterRow, id: string): number {
  const d = DIALS.find((dial) => dial.id === id);
  return character.dialValues[id] ?? d?.defaultValue ?? 0.5;
}

function strongAxisCount(character: CharacterRow): number {
  return Object.values(character.dialValues || {}).filter((v) => Math.abs(v - 0.5) >= 0.25).length;
}

function voiceReadoutBars(character: CharacterRow): AxisReadoutBar[] {
  return [
    { label: 'DIR', value: pct(dialValue(character, 'hedged_direct')) },
    { label: 'WRM', value: pct(dialValue(character, 'warm_cool')) },
    { label: 'PRO', value: pct(dialValue(character, 'reactive_proactive')) },
    { label: 'OPN', value: pct(dialValue(character, 'opinionated_mirroring')) },
    { label: 'MEM', value: pct(dialValue(character, 'memory_continuity')) },
    { label: 'STK', value: pct(dialValue(character, 'stakes_sensitivity')) },
  ];
}

function purposePyramid(character: CharacterRow) {
  return {
    labels: ['domain', 'register', 'state', 'stakes', 'quirk', 'rules'],
    left: [
      Math.min(100, character.taskDomainIds.length * 8),
      Math.min(100, character.relationshipRegisterIds.length * 14),
      Math.min(100, character.userStateIds.length * 12),
      Math.min(100, character.stakeProfileIds.length * 18),
      Math.min(100, character.quirkIds.length * 16),
      Math.min(100, character.boundaryRuleIds.length * 18),
    ],
    right: [
      pct(dialValue(character, 'cautious_helpful')),
      pct(dialValue(character, 'emotional_attunement')),
      pct(dialValue(character, 'default_initiative')),
      pct(dialValue(character, 'stakes_sensitivity')),
      pct(dialValue(character, 'roleplay_flexibility')),
      pct(dialValue(character, 'refusal_bluntness')),
    ],
  };
}

function purposeVenn(character: CharacterRow, width = 250, height = 170): VennDatum[] {
  const maxR = Math.max(24, Math.min(52, Math.min(width, height) * 0.34));
  const domains = Math.max(20, Math.min(maxR, 22 + character.taskDomainIds.length * 2));
  const registers = Math.max(20, Math.min(maxR, 26 + character.relationshipRegisterIds.length * 4));
  const stakes = Math.max(20, Math.min(maxR, 24 + character.stakeProfileIds.length * 5));
  return [
    { label: 'work', cx: width * 0.38, cy: height * 0.47, r: domains, color: 'theme:tool', size: character.taskDomainIds.length },
    { label: 'voice', cx: width * 0.62, cy: height * 0.47, r: registers, color: 'theme:atch', size: character.relationshipRegisterIds.length },
    { label: 'stakes', cx: width * 0.5, cy: height * 0.68, r: stakes, color: 'theme:blue', size: character.stakeProfileIds.length },
  ];
}

function previewLifecycle(character: CharacterRow): WorkerLifecycle {
  const strong = strongAxisCount(character);
  if (strong >= 10) return 'streaming';
  if (strong >= 5) return 'active';
  if (character.boundaryRuleIds.length >= 3) return 'suspended';
  return 'idle';
}

function previewWorker(character: CharacterRow): Worker {
  return {
    id: `character_${character.id}_${character.archetypeId || 'custom'}`,
    userId: character.userId,
    workspaceId: 'ws_character_creator',
    settingsId: character.settingsId,
    label: character.displayName || character.name || 'Character',
    kind: 'primary',
    lifecycle: previewLifecycle(character),
    connectionId: 'conn_character_manifest',
    modelId: character.archetypeId || 'custom',
    maxConcurrentRequests: 1,
    spawnedAt: character.createdAt,
    lastActivityAt: character.updatedAt,
  };
}

function DiscreteSlider({
  value,
  onChange,
  width = 180,
}: {
  value: number;
  onChange: (next: number) => void;
  width?: number;
}) {
  const idx = Math.round(value * (SLIDER_STEPS - 1));
  return (
    <S.AppStepCubeRow style={{ width, flexGrow: 0, flexShrink: 0 }}>
      {Array.from({ length: SLIDER_STEPS }, (_v, i) => {
        const stepValue = i / (SLIDER_STEPS - 1);
        const Cube = i === idx
          ? S.AppStepCubeCurrent
          : i === Math.floor((SLIDER_STEPS - 1) / 2)
            ? S.AppStepCubePast
            : S.AppStepCubeFuture;
        return <Cube key={i} onPress={() => onChange(stepValue)} />;
      })}
    </S.AppStepCubeRow>
  );
}

function AxisRow({
  left,
  right,
  value,
  onChange,
  leftWidth = 86,
  rightWidth = 94,
  width = 426,
}: {
  left: string;
  right: string;
  value: number;
  onChange: (next: number) => void;
  leftWidth?: number;
  rightWidth?: number;
  width?: number;
}) {
  return (
    <Row style={{ width, gap: 8, alignItems: 'center', flexShrink: 0 }}>
      <Box style={{ width: leftWidth }}>
        <S.Body style={{ textAlign: 'right' }}>{left}</S.Body>
      </Box>
      <DiscreteSlider value={value} onChange={onChange} />
      <Box style={{ width: rightWidth }}>
        <S.Body>{right}</S.Body>
      </Box>
      <Box style={{ width: 34 }}>
        <S.Caption style={{ textAlign: 'right' }}>{value.toFixed(2)}</S.Caption>
      </Box>
    </Row>
  );
}

// ── Section components ────────────────────────────────────────────────

function IdentitySection() {
  const c = useCharacter();
  // Refs read live state from inside controlled inputs (Pressable stale-
  // closure pattern; same idea for TextInput's onChangeText).
  const nameRef = useRef(c.character.name);
  const displayRef = useRef(c.character.displayName ?? '');
  const bioRef = useRef(c.character.bio ?? '');
  nameRef.current = c.character.name;
  displayRef.current = c.character.displayName ?? '';
  bioRef.current = c.character.bio ?? '';

  return (
    <CharacterCard>
      <Col style={{ gap: 4 }}>
        <S.Label>Name</S.Label>
        <S.AppFormInput
          value={c.character.name}
          placeholder="Sage"
          onChangeText={(t: string) => { nameRef.current = t; void c.setName(t); }}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Display name</S.Label>
        <S.AppFormInput
          value={c.character.displayName ?? ''}
          placeholder="(optional shortname)"
          onChangeText={(t: string) => { displayRef.current = t; void c.setDisplayName(t); }}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Bio (one line)</S.Label>
        <S.AppFormInput
          value={c.character.bio ?? ''}
          placeholder="Concise, willing to disagree, signs off with a closing thought."
          onChangeText={(t: string) => { bioRef.current = t; void c.setBio(t); }}
        />
      </Col>
    </CharacterCard>
  );
}

function ArchetypeSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <Row style={{ width: '100%', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box style={{ flexGrow: 1, flexBasis: 0 }}>
          <S.Caption>
            Pick a starting voice. Seeds dials + quirks + stances. You can change anything below afterward.
          </S.Caption>
        </Box>
        <MoreOptionsButton kind="archetype" />
      </Row>
      <Box style={{ width: '100%', alignItems: 'center' }}>
        <Row style={{ width: '100%', maxWidth: 960, gap: 0, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          {ARCHETYPES.map((a) => (
            <ArchetypeCard
              key={a.id}
              label={a.label}
              description={a.description}
              active={c.character.archetypeId === a.id}
              onPress={() => void c.setArchetype(a.id)}
            />
          ))}
        </Row>
      </Box>
    </CharacterCard>
  );
}

function DialsSection() {
  const c = useCharacter();
  const featured = FEATURED_DIAL_IDS
    .map((id) => DIALS.find((d) => d.id === id))
    .filter(Boolean) as typeof DIALS;
  return (
    <CharacterCard>
      <S.Caption>
        Bipolar axes. Mid-range values (around 0.5) contribute lightly — push toward a pole to make the voice legible.
      </S.Caption>
      <Box style={{ width: '100%', alignItems: 'center' }}>
        <Row style={{ width: '100%', maxWidth: 760, gap: 14, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
          <AxisReadout axisLabel="VOICE SKEW" bars={voiceReadoutBars(c.character)} />
          <Row style={{ width: '100%', maxWidth: 450, gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            {featured.map((d, i) => {
              const v = c.character.dialValues[d.id] ?? d.defaultValue;
              const tone = i === 0 ? 'accent' : i === 1 ? 'ok' : i === 2 ? 'warn' : 'blue';
              return (
                <Tooltip
                  key={d.id}
                  label={`${d.left} to ${d.right}`}
                  side="top"
                  delayMs={250}
                >
                  <MeterSlider
                    value={pct(v)}
                    label={`${String(pct(v)).padStart(3, '0')} / ${d.right.toUpperCase().slice(0, 10)}`}
                    width={220}
                    tone={tone}
                    onChange={(next) => void c.setDialValue(d.id, next / 100)}
                  />
                </Tooltip>
              );
            })}
          </Row>
        </Row>
      </Box>
      <Box style={{ width: '100%', alignItems: 'center' }}>
        <Row style={{ width: '100%', maxWidth: 866, gap: 14, flexWrap: 'wrap', justifyContent: 'flex-start', alignItems: 'flex-start' }}>
          {DIALS.map((d) => {
            const v = c.character.dialValues[d.id] ?? d.defaultValue;
            return (
              <AxisRow
                key={d.id}
                left={d.left}
                right={d.right}
                value={v}
                onChange={(next) => void c.setDialValue(d.id, next)}
              />
            );
          })}
        </Row>
      </Box>
    </CharacterCard>
  );
}

function ManifestChartsCard() {
  const c = useCharacter();
  const pyramid = purposePyramid(c.character);
  const vennW = 280;
  const vennH = 220;
  return (
    <CharacterCard style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 10, gap: 8 }}>
      <Row style={{ width: '100%', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box style={{ flexGrow: 1, flexBasis: 0 }}>
          <S.Label>MANIFEST</S.Label>
        </Box>
        <Box style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          borderWidth: 1,
          borderColor: 'theme:border',
          borderRadius: 4,
        }}>
          <S.Caption>{strongAxisCount(c.character)} strong axes</S.Caption>
        </Box>
      </Row>
      <Box style={{ width: '100%', flexGrow: 1, flexBasis: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Col style={{ width: '100%', maxWidth: 300, gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          <Tooltip label="Population Pyramid compares chosen scope against the assistant's configured pressure." side="top" delayMs={250}>
            <Box style={{ width: 300, height: 150 }}>
              <StaticSurface>
                <PopulationPyramid labels={pyramid.labels} left={pyramid.left} right={pyramid.right} width={300} height={150} />
              </StaticSurface>
            </Box>
          </Tooltip>
          <Tooltip label="Venn Diagram shows overlap between work domains, social register, and stakes." side="top" delayMs={250}>
            <Box style={{ width: vennW, height: vennH }}>
              <StaticSurface>
                <Venn data={purposeVenn(c.character, vennW, vennH)} width={vennW} height={vennH} />
              </StaticSurface>
            </Box>
          </Tooltip>
        </Col>
      </Box>
    </CharacterCard>
  );
}

function VoiceRailCard() {
  const c = useCharacter();
  return (
    <CharacterCard style={{ flexShrink: 0, padding: 10, gap: 7 }}>
      <Row style={{ width: '100%', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <S.Label>VOICE</S.Label>
        <S.Caption>{c.character.initiativeProfile}</S.Caption>
      </Row>
      <Box style={{ width: '100%', alignItems: 'center' }}>
        <AxisReadout axisLabel="SKEW" bars={voiceReadoutBars(c.character)} />
      </Box>
    </CharacterCard>
  );
}

function QuirksSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <Row style={{ width: '100%', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <S.Caption>Toggle on the quirks this character carries.</S.Caption>
        <MoreOptionsButton kind="quirks" />
      </Row>
      <Row style={{ width: '100%', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        {QUIRKS.map((q) => (
          <Chip
            key={q.id}
            label={q.label}
            active={c.character.quirkIds.includes(q.id)}
            onPress={() => void c.toggleQuirk(q.id)}
          />
        ))}
      </Row>
    </CharacterCard>
  );
}

function StanceTriadSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <Row style={{ width: '100%', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
        <MoreOptionsButton kind="stance" />
      </Row>
      <Col style={{ gap: 6 }}>
        <S.Label>Relationship stance</S.Label>
        <Segmented options={STANCES} value={c.character.relationshipStance} onPick={(s) => void c.setRelationshipStance(s)} />
      </Col>
      <Col style={{ gap: 6 }}>
        <S.Label>Initiative profile</S.Label>
        <Segmented options={INITIATIVES} value={c.character.initiativeProfile} onPick={(p) => void c.setInitiativeProfile(p)} />
      </Col>
      <Col style={{ gap: 6 }}>
        <S.Label>Correction style</S.Label>
        <Segmented options={CORRECTIONS} value={c.character.correctionStyle} onPick={(s) => void c.setCorrectionStyle(s)} />
      </Col>
    </CharacterCard>
  );
}

function BoundariesSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <Row style={{ width: '100%', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box style={{ flexGrow: 1, flexBasis: 0 }}>
          <S.Caption>
            Boundary rules travel with the character. These reuse the existing Constraint shape — no parallel type.
          </S.Caption>
        </Box>
        <MoreOptionsButton kind="boundaries" />
      </Row>
      <Row style={{ width: '100%', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        {BOUNDARY_RULES.map((b) => (
          <Chip
            key={b.id}
            label={b.label}
            active={c.character.boundaryRuleIds.includes(b.id)}
            onPress={() => void c.toggleBoundaryRule(b.id)}
          />
        ))}
      </Row>
    </CharacterCard>
  );
}

function MultiSelectChips({
  options,
  selected,
  onToggle,
}: {
  options: CatalogOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <Row style={{ width: '100%', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      {options.map((o) => (
        <Chip
          key={o.id}
          label={o.label}
          active={selected.includes(o.id)}
          onPress={() => onToggle(o.id)}
        />
      ))}
    </Row>
  );
}

function TaskDomainsSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Domains where this assistant is allowed to develop a recognizable posture.</S.Caption>
      <MultiSelectChips
        options={TASK_DOMAINS}
        selected={c.character.taskDomainIds}
        onToggle={(id) => void c.toggleTaskDomain(id)}
      />
    </CharacterCard>
  );
}

function RelationshipRegisterSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Registers the assistant can inhabit. These guide the social contract before any task starts.</S.Caption>
      <MultiSelectChips
        options={RELATIONSHIP_REGISTERS}
        selected={c.character.relationshipRegisterIds}
        onToggle={(id) => void c.toggleRelationshipRegister(id)}
      />
    </CharacterCard>
  );
}

function UserStateSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>States this character should explicitly adapt to when the user names them or the manifest infers them.</S.Caption>
      <MultiSelectChips
        options={USER_STATES}
        selected={c.character.userStateIds}
        onToggle={(id) => void c.toggleUserState(id)}
      />
    </CharacterCard>
  );
}

function StakesSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Stakes profiles this character knows how to mirror. The stakes-sensitivity dial controls how hard it shifts.</S.Caption>
      <MultiSelectChips
        options={STAKE_PROFILES}
        selected={c.character.stakeProfileIds}
        onToggle={(id) => void c.toggleStakeProfile(id)}
      />
    </CharacterCard>
  );
}

function KnowledgeSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Specializations are selected as domains, then weighted. Higher means this character reaches for that frame earlier.</S.Caption>
      <MultiSelectChips
        options={KNOWLEDGE_SPECIALIZATIONS}
        selected={c.character.knowledgeSpecializationIds}
        onToggle={(id) => void c.toggleKnowledgeSpecialization(id)}
      />
      <Box style={{ width: '100%', alignItems: 'center' }}>
        <Row style={{ width: '100%', maxWidth: 866, gap: 14, flexWrap: 'wrap', justifyContent: 'flex-start', alignItems: 'flex-start' }}>
          {KNOWLEDGE_SPECIALIZATIONS.filter((k) => c.character.knowledgeSpecializationIds.includes(k.id)).map((k) => {
            const v = c.character.knowledgeWeights[k.id] ?? 0.5;
            return (
              <AxisRow
                key={k.id}
                left={k.label}
                right="Influence"
                value={v}
                leftWidth={110}
                rightWidth={74}
                width={426}
                onChange={(next) => void c.setKnowledgeWeight(k.id, next)}
              />
            );
          })}
        </Row>
      </Box>
    </CharacterCard>
  );
}

// ── Embodiment + advanced routing ────────────────────────────────────

function EmbodimentSection() {
  const c = useCharacter();
  const avatarRef = useRef(c.character.avatarRef ?? '');
  const voiceRef = useRef(c.character.voiceThumbnailRef ?? '');
  const themeRef = useRef(c.character.themeId ?? '');
  avatarRef.current = c.character.avatarRef ?? '';
  voiceRef.current = c.character.voiceThumbnailRef ?? '';
  themeRef.current = c.character.themeId ?? '';
  return (
    <CharacterCard>
      <S.Caption>
        Visual + auditory + chrome refs. The avatar pipeline is TBD; until then any URL or local
        path is preserved verbatim. Theme id must be a `theme:NAME` token — never a hex literal,
        per the no-color-drift rule.
      </S.Caption>
      <Col style={{ gap: 4 }}>
        <S.Label>Avatar ref</S.Label>
        <S.AppFormInput
          value={c.character.avatarRef ?? ''}
          placeholder="url, file path, or asset id"
          onChangeText={(t: string) => { avatarRef.current = t; void c.setAvatarRef(t); }}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Voice thumbnail ref</S.Label>
        <S.AppFormInput
          value={c.character.voiceThumbnailRef ?? ''}
          placeholder="audio sample url / path"
          onChangeText={(t: string) => { voiceRef.current = t; void c.setVoiceThumbnailRef(t); }}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Theme id</S.Label>
        <S.AppFormInput
          value={c.character.themeId ?? ''}
          placeholder="theme:characterAccentSage"
          onChangeText={(t: string) => { themeRef.current = t; void c.setThemeId(t); }}
        />
      </Col>
    </CharacterCard>
  );
}

function AdvancedRoutingSection() {
  const c = useCharacter();
  const compRef = useRef(c.character.compositionId ?? '');
  compRef.current = c.character.compositionId ?? '';
  return (
    <CharacterCard>
      <S.Caption>
        Advanced. Override the default `comp_character_who` prompt-composition by pointing at a
        custom Composition row. Leave empty for the standard voice-assembly path.
      </S.Caption>
      <Col style={{ gap: 4 }}>
        <S.Label>Composition id (optional)</S.Label>
        <S.AppFormInput
          value={c.character.compositionId ?? ''}
          placeholder="comp_custom_voice"
          onChangeText={(t: string) => { compRef.current = t; void c.setCompositionId(t); }}
        />
      </Col>
    </CharacterCard>
  );
}

// ── Knowledge sources sub-form ───────────────────────────────────────

const KNOWLEDGE_SOURCE_KINDS: { id: 'file' | 'url' | 'inline' | 'asset' | 'style-reference'; label: string }[] = [
  { id: 'file', label: 'file' },
  { id: 'url', label: 'url' },
  { id: 'inline', label: 'inline' },
  { id: 'asset', label: 'asset' },
  { id: 'style-reference', label: 'style-ref' },
];

const KNOWLEDGE_SOURCE_INFLUENCES: {
  id: 'voice' | 'backstory' | 'knowledge-weight' | 'style' | 'boundary' | 'avatar' | 'custom' | 'none';
  label: string;
}[] = [
  { id: 'none', label: '—' },
  { id: 'voice', label: 'voice' },
  { id: 'backstory', label: 'backstory' },
  { id: 'knowledge-weight', label: 'knowledge' },
  { id: 'style', label: 'style' },
  { id: 'boundary', label: 'boundary' },
  { id: 'avatar', label: 'avatar' },
  { id: 'custom', label: 'custom' },
];

function KnowledgeSourcesSection() {
  const c = useCharacter();
  const sources = c.character.knowledgeSources;
  return (
    <CharacterCard>
      <S.Caption>
        Files, urls, or inline text the character treats as canon. Composer slots them via
        src_character-snapshot. Influence is an optional channel hint — what dimension this
        source informs (voice / backstory / style / etc.). Weight is a 0–1 emphasis.
      </S.Caption>
      <Col style={{ gap: 12 }}>
        {sources.map((src) => {
          const influence = src.influence ?? 'none';
          return (
            <Col key={src.id} style={{
              gap: 6,
              padding: 10,
              borderWidth: 1,
              borderColor: 'theme:rule',
              borderRadius: 6,
              backgroundColor: 'theme:bg',
            }}>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Box style={{ flexGrow: 1, flexBasis: 0 }}>
                  <S.AppFormInput
                    value={src.label}
                    placeholder="label (e.g. 'librarian voice notes')"
                    onChangeText={(t: string) => void c.updateKnowledgeSource(src.id, { label: t })}
                  />
                </Box>
                <S.ButtonOutline onPress={() => void c.removeKnowledgeSource(src.id)}>
                  <S.ButtonOutlineLabel>Remove</S.ButtonOutlineLabel>
                </S.ButtonOutline>
              </Row>
              <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box style={{ width: 80 }}><S.Label>Kind</S.Label></Box>
                <Segmented
                  options={KNOWLEDGE_SOURCE_KINDS}
                  value={src.kind}
                  onPick={(k) => void c.updateKnowledgeSource(src.id, { kind: k })}
                />
              </Row>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Box style={{ width: 80 }}><S.Label>Locator</S.Label></Box>
                <Box style={{ flexGrow: 1, flexBasis: 0 }}>
                  <S.AppFormInput
                    value={src.locator}
                    placeholder={src.kind === 'inline' ? 'inline body text' : 'path / url / asset id'}
                    onChangeText={(t: string) => void c.updateKnowledgeSource(src.id, { locator: t })}
                  />
                </Box>
              </Row>
              <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box style={{ width: 80 }}><S.Label>Influence</S.Label></Box>
                <Segmented
                  options={KNOWLEDGE_SOURCE_INFLUENCES}
                  value={influence}
                  onPick={(inf) =>
                    void c.updateKnowledgeSource(src.id, { influence: inf === 'none' ? undefined : inf })
                  }
                />
              </Row>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Box style={{ width: 80 }}><S.Label>Weight</S.Label></Box>
                <AxisRow
                  left=""
                  right={typeof src.weight === 'number' ? src.weight.toFixed(2) : '—'}
                  value={typeof src.weight === 'number' ? src.weight : 0.5}
                  leftWidth={0}
                  rightWidth={48}
                  width={360}
                  onChange={(next) => void c.updateKnowledgeSource(src.id, { weight: next })}
                />
              </Row>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Box style={{ width: 80 }}><S.Label>Description</S.Label></Box>
                <Box style={{ flexGrow: 1, flexBasis: 0 }}>
                  <S.AppFormInput
                    value={src.description ?? ''}
                    placeholder="(optional) one-line note"
                    onChangeText={(t: string) => void c.updateKnowledgeSource(src.id, { description: t || undefined })}
                  />
                </Box>
              </Row>
            </Col>
          );
        })}
        <Row style={{ width: '100%', justifyContent: 'flex-end' }}>
          <S.Button onPress={() => void c.addKnowledgeSource()}>
            <S.ButtonLabel>Add source</S.ButtonLabel>
          </S.Button>
        </Row>
      </Col>
    </CharacterCard>
  );
}

function BackstorySection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <Col style={{ gap: 4 }}>
        <S.Label>Fictional backstory</S.Label>
        <S.AppFormInput
          value={c.character.fictionalBackstory}
          placeholder="A costume, not a claim: research librarian turned systems engineer."
          onChangeText={(t: string) => void c.setFictionalBackstory(t)}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Profile image / embodiment prompt</S.Label>
        <S.AppFormInput
          value={c.character.profileImagePrompt}
          placeholder="Stylized face, hair, color palette, vibe, silhouette."
          onChangeText={(t: string) => void c.setProfileImagePrompt(t)}
        />
      </Col>
    </CharacterCard>
  );
}

function RelationshipProjectionSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Optional projection of who the user is to this character. This lets one assistant know you as a coworker while another knows you as a student, friend, or client.</S.Caption>
      <Row style={{ width: '100%', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
          <S.Label>User identity to character</S.Label>
          <S.AppFormInput
            value={c.character.userIdentityToCharacter}
            placeholder="Siah, the builder I work with on ReactJIT."
            onChangeText={(t: string) => void c.setUserIdentityToCharacter(t)}
          />
        </Col>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 180 }}>
          <S.Label>Relationship type</S.Label>
          <S.AppFormInput
            value={c.character.relationshipType}
            placeholder="coworker, mentor, rival, friend"
            onChangeText={(t: string) => void c.setRelationshipType(t)}
          />
        </Col>
      </Row>
      <Col style={{ gap: 4 }}>
        <S.Label>Relationship context</S.Label>
        <S.AppFormInput
          value={c.character.relationshipContext}
          placeholder="What this character should assume about the relationship before any task starts."
          onChangeText={(t: string) => void c.setRelationshipContext(t)}
        />
      </Col>
    </CharacterCard>
  );
}

function ContinuitySeedSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Optional continuity seeds. They shape the relationship substrate without pretending a visible chat happened.</S.Caption>
      <Col style={{ gap: 4 }}>
        <S.Label>Continuity seed</S.Label>
        <S.AppFormInput
          value={c.character.continuitySeed}
          placeholder="We have collaborated before; this assistant remembers my taste for direct critique."
          onChangeText={(t: string) => void c.setContinuitySeed(t)}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Ghost history seed</S.Label>
        <S.AppFormInput
          value={c.character.ghostHistorySeed}
          placeholder="A light fictional history or first-meeting frame, clearly treated as posture."
          onChangeText={(t: string) => void c.setGhostHistorySeed(t)}
        />
      </Col>
    </CharacterCard>
  );
}

function IdentityIntegritySection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Optional guardrails for identity drift, recovery, and in-character fallback when the model slips.</S.Caption>
      <Col style={{ gap: 4 }}>
        <S.Label>Identity guardrails</S.Label>
        <S.AppFormInput
          value={c.character.identityGuardrails}
          placeholder="Never claim to be the user; avoid generic AI-speak; keep the named posture."
          onChangeText={(t: string) => void c.setIdentityGuardrails(t)}
        />
      </Col>
      <Row style={{ width: '100%', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
          <S.Label>Recovery style</S.Label>
          <S.AppFormInput
            value={c.character.identityRecoveryStyle}
            placeholder="Briefly correct course and continue without over-apologizing."
            onChangeText={(t: string) => void c.setIdentityRecoveryStyle(t)}
          />
        </Col>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
          <S.Label>Fallback deflections</S.Label>
          <S.AppFormInput
            value={c.character.fallbackDeflections}
            placeholder="How it dodges topics it cannot or should not handle."
            onChangeText={(t: string) => void c.setFallbackDeflections(t)}
          />
        </Col>
      </Row>
    </CharacterCard>
  );
}

function RoleplayIdentitySection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <Row style={{ width: '100%', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 150 }}>
          <S.Label>Age</S.Label>
          <S.AppFormInput value={c.character.roleplayAge} placeholder="Optional" onChangeText={(t: string) => void c.setRoleplayAge(t)} />
        </Col>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 150 }}>
          <S.Label>Race</S.Label>
          <S.AppFormInput value={c.character.roleplayRace} placeholder="Optional" onChangeText={(t: string) => void c.setRoleplayRace(t)} />
        </Col>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 150 }}>
          <S.Label>Gender</S.Label>
          <S.AppFormInput value={c.character.roleplayGender} placeholder="Optional" onChangeText={(t: string) => void c.setRoleplayGender(t)} />
        </Col>
      </Row>
      <Col style={{ gap: 4 }}>
        <S.Label>Location</S.Label>
        <S.AppFormInput value={c.character.roleplayLocation} placeholder="Fictional or real-world framing." onChangeText={(t: string) => void c.setRoleplayLocation(t)} />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Motive</S.Label>
        <S.AppFormInput value={c.character.roleplayMotive} placeholder="Why this assistant wants to help, in character terms." onChangeText={(t: string) => void c.setRoleplayMotive(t)} />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Likes</S.Label>
        <S.AppFormInput value={c.character.likes} placeholder="Kinds of work, references, aesthetics." onChangeText={(t: string) => void c.setLikes(t)} />
      </Col>
      <Col style={{ gap: 4 }}>
        <S.Label>Dislikes</S.Label>
        <S.AppFormInput value={c.character.dislikes} placeholder="Things this character resists or avoids." onChangeText={(t: string) => void c.setDislikes(t)} />
      </Col>
    </CharacterCard>
  );
}

function DeliveryPatternSection() {
  const c = useCharacter();
  return (
    <CharacterCard>
      <S.Caption>Optional runtime texture: how much it thinks, when it is available, and how it packages messages.</S.Caption>
      <Col style={{ gap: 4 }}>
        <S.Label>Deliberation profile</S.Label>
        <S.AppFormInput
          value={c.character.deliberationProfile}
          placeholder="Quick by default; think harder for personal, risky, or architectural decisions."
          onChangeText={(t: string) => void c.setDeliberationProfile(t)}
        />
      </Col>
      <Row style={{ width: '100%', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
          <S.Label>Availability profile</S.Label>
          <S.AppFormInput
            value={c.character.availabilityProfile}
            placeholder="Morning planner, late-night sparring partner, office-hours only."
            onChangeText={(t: string) => void c.setAvailabilityProfile(t)}
          />
        </Col>
        <Col style={{ gap: 4, flexGrow: 1, flexBasis: 220 }}>
          <S.Label>Delivery pattern</S.Label>
          <S.AppFormInput
            value={c.character.deliveryPattern}
            placeholder="Single concise reply, multi-message bursts, asks before long dives."
            onChangeText={(t: string) => void c.setDeliveryPattern(t)}
          />
        </Col>
      </Row>
    </CharacterCard>
  );
}

function CustomPropertiesSection() {
  const c = useCharacter();
  const [keyDraft, setKeyDraft] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const add = () => {
    const k = keyDraft.trim();
    if (!k) return;
    void c.setCustomProperty(k, valueDraft);
    setKeyDraft('');
    setValueDraft('');
  };
  const entries = Object.entries(c.character.customProperties || {});
  return (
    <CharacterCard>
      <S.Caption>Open key-value store for user-specific character properties that do not deserve a first-class control yet.</S.Caption>
      {entries.map(([k, v]) => (
        <Row key={k} style={{ gap: 8, alignItems: 'center' }}>
          <Box style={{ width: 150 }}>
            <S.Label>{k}</S.Label>
          </Box>
          <Box style={{ flexGrow: 1, flexBasis: 0 }}>
            <S.Body>{v}</S.Body>
          </Box>
          <S.ButtonOutline onPress={() => void c.removeCustomProperty(k)}>
            <S.ButtonOutlineLabel>Remove</S.ButtonOutlineLabel>
          </S.ButtonOutline>
        </Row>
      ))}
      <Row style={{ width: '100%', gap: 8, alignItems: 'center' }}>
        <Box style={{ flexGrow: 1, flexBasis: 0 }}>
          <S.AppFormInput value={keyDraft} placeholder="property" onChangeText={(t: string) => setKeyDraft(t)} />
        </Box>
        <Box style={{ flexGrow: 2, flexBasis: 0 }}>
          <S.AppFormInput value={valueDraft} placeholder="value" onChangeText={(t: string) => setValueDraft(t)} />
        </Box>
        <S.Button onPress={add}>
          <S.ButtonLabel>Add</S.ButtonLabel>
        </S.Button>
      </Row>
    </CharacterCard>
  );
}

function SaveBar() {
  const c = useCharacter();
  return (
    <Row style={{ width: '100%', gap: 12, alignItems: 'center', justifyContent: 'flex-end', paddingTop: 14 }}>
      <S.Caption>Version {c.character.version}</S.Caption>
      <S.Button onPress={() => void c.save()}>
        <S.ButtonLabel>Save character</S.ButtonLabel>
      </S.Button>
    </Row>
  );
}

// ── Avatar preview column ─────────────────────────────────────────────

const BACKDROP_SWATCHES = ['#0a0e18', '#1a1f2e', '#2a3347', '#3a4d5c', '#5a3a3a'];
const PREVIEW_AVATAR_H = 160;

function AnimatedManifestText() {
  const c = useCharacter();
  const target = `${c.character.displayName || c.character.name || 'character'} / ${c.character.relationshipStance} / ${c.character.initiativeProfile}`.toUpperCase();
  const wave = useGradientWave(target, { speed: 0.9, spread: 0.22 });
  const scrambled = useScramble(
    `V${c.character.version} ${strongAxisCount(c.character)} AXES ${c.character.boundaryRuleIds.length} RULES`,
    { durationMs: 900, loop: true, loopHoldMs: 2600, scrambleChance: 0.55 }
  );
  return (
    <Col style={{ width: '100%', gap: 3, marginTop: 4, alignItems: 'center' }}>
      <Row style={{ width: '100%', gap: 0, flexWrap: 'wrap', justifyContent: 'center' }}>
        {wave.map((cell) => (
          <Text
            key={cell.index}
            fontSize={10}
            fontFamily="monospace"
            fontWeight="700"
            color={cell.color}
          >
            {cell.ch}
          </Text>
        ))}
      </Row>
      <S.Caption style={{ textAlign: 'center' }}>{scrambled}</S.Caption>
    </Col>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <Col style={{
      flexGrow: 1,
      flexBasis: 78,
      minHeight: 32,
      gap: 2,
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 6,
      paddingRight: 6,
      borderWidth: 1,
      borderColor: 'theme:rule',
      borderRadius: 4,
      backgroundColor: 'theme:bg',
    }}>
      <S.Label>{label}</S.Label>
      <S.Body>{value}</S.Body>
    </Col>
  );
}

function AvatarPreview() {
  const c = useCharacter();
  const [backdrop, setBackdrop] = useState(BACKDROP_SWATCHES[0]);
  const worker = previewWorker(c.character);
  const customCount = Object.keys(c.character.customProperties || {}).length;
  return (
    <Col style={{ width: '100%', height: '100%', gap: 8, justifyContent: 'flex-start', overflow: 'hidden' }}>
      <CharacterCard style={{ flexShrink: 0, padding: 8, gap: 5 }}>
        <S.Label style={{ color: 'theme:accentHot' }}>PREVIEW</S.Label>
        <Box style={{ width: '100%', height: PREVIEW_AVATAR_H, overflow: 'hidden', position: 'relative' }}>
          <Avatar
            avatar={DEFAULT_AVATAR}
            style={{ width: '100%', height: PREVIEW_AVATAR_H }}
            backgroundColor={backdrop}
            cameraPosition={[0, 1.0, 3.8]}
            cameraTarget={[0, 0.85, 0]}
            cameraFov={48}
          >
            <BlockFace3D
              center={[0, 1.55, 0]}
              radius={0.35}
              archetype={archetypeForWorker(worker)}
              seed={worker.id}
            />
          </Avatar>
        </Box>
        <S.Heading>{c.character.name || '(unnamed)'}</S.Heading>
        {c.character.displayName ? <S.BodyDim>aka {c.character.displayName}</S.BodyDim> : null}
        {c.character.bio ? <S.BodyDim>{c.character.bio}</S.BodyDim> : null}
        <Row style={{ width: '100%', gap: 6, marginTop: 4, justifyContent: 'center' }}>
          {BACKDROP_SWATCHES.map((color) => (
            <Pressable
              key={color}
              onPress={() => setBackdrop(color)}
              style={{
                width: 28,
                height: 24,
                borderRadius: 12,
                backgroundColor: color,
                borderWidth: backdrop === color ? 2 : 1,
                borderColor: backdrop === color ? 'theme:accentHot' : 'theme:border',
              }}
            />
          ))}
        </Row>
        <Row style={{ width: '100%', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: 5 }}>
          {/* BlockFaces' animated badge cycles through frames whose
              grid dimensions vary; even pinned to a fixed-height box
              the per-frame setState re-renders cascade into the
              framework's layout pass and bistabilize the ScrollView's
              content_height. Removing the animated badge from
              /character entirely until we have a `paused` knob through
              BlockFaces (or a stable static-frame badge variant). */}
        </Row>
        {/* DEBUG-OFF: <AnimatedManifestText /> */}
      </CharacterCard>
      <CharacterCard style={{ flexShrink: 0, padding: 8, gap: 5 }}>
        <Row style={{ width: '100%', gap: 6, flexWrap: 'wrap', alignItems: 'stretch', justifyContent: 'flex-start' }}>
          <PreviewStat label="Stance" value={c.character.relationshipStance} />
          <PreviewStat label="Initiative" value={c.character.initiativeProfile} />
          <PreviewStat label="Correction" value={c.character.correctionStyle} />
          <PreviewStat label="Quirks" value={c.character.quirkIds.length === 0 ? '-' : String(c.character.quirkIds.length)} />
          <PreviewStat label="Rules" value={c.character.boundaryRuleIds.length === 0 ? '-' : String(c.character.boundaryRuleIds.length)} />
          <PreviewStat label="Domains" value={c.character.taskDomainIds.length === 0 ? '-' : String(c.character.taskDomainIds.length)} />
          <PreviewStat label="Registers" value={c.character.relationshipRegisterIds.length === 0 ? '-' : String(c.character.relationshipRegisterIds.length)} />
          <PreviewStat label="Knowledge" value={c.character.knowledgeSpecializationIds.length === 0 ? '-' : String(c.character.knowledgeSpecializationIds.length)} />
          <PreviewStat label="Sources" value={(c.character.knowledgeSources?.length ?? 0) === 0 ? '-' : String(c.character.knowledgeSources.length)} />
          <PreviewStat label="Custom" value={customCount === 0 ? '-' : String(customCount)} />
        </Row>
      </CharacterCard>
      <VoiceRailCard />
      <ManifestChartsCard />
    </Col>
  );
}

// ── Page body ─────────────────────────────────────────────────────────

type StationId = 'identity' | 'purpose' | 'voice' | 'behavior' | 'knowledge' | 'fiction';

const STATIONS: { id: StationId; label: string; kicker: string }[] = [
  { id: 'identity', label: 'Identity', kicker: 'Name, bio, backstory, embodiment.' },
  { id: 'purpose', label: 'Purpose', kicker: 'Domains, register, stakes.' },
  { id: 'voice', label: 'Voice Lab', kicker: 'Archetype and sliders.' },
  { id: 'behavior', label: 'Behavior', kicker: 'Quirks, stance, state, boundaries.' },
  { id: 'knowledge', label: 'Knowledge', kicker: 'Specializations and weights.' },
  { id: 'fiction', label: 'Fiction', kicker: 'Roleplay identity and custom keys.' },
];

function stationMetric(id: StationId, c: ReturnType<typeof useCharacter>): string {
  if (id === 'identity') {
    let n = 0;
    if (c.character.name) n++;
    if (c.character.displayName) n++;
    if (c.character.bio) n++;
    if (c.character.fictionalBackstory) n++;
    if (c.character.profileImagePrompt) n++;
    if (c.character.userIdentityToCharacter) n++;
    if (c.character.relationshipType) n++;
    if (c.character.relationshipContext) n++;
    if (c.character.continuitySeed) n++;
    if (c.character.ghostHistorySeed) n++;
    if (c.character.avatarRef) n++;
    if (c.character.voiceThumbnailRef) n++;
    if (c.character.themeId) n++;
    if (c.character.compositionId) n++;
    return `${n}/14 set`;
  }
  if (id === 'purpose') {
    return `${c.character.taskDomainIds.length + c.character.relationshipRegisterIds.length + c.character.stakeProfileIds.length} picks`;
  }
  if (id === 'voice') {
    const pushed = Object.values(c.character.dialValues || {}).filter((v) => Math.abs(v - 0.5) >= 0.25).length;
    return `${pushed} strong axes`;
  }
  if (id === 'behavior') {
    let n = c.character.quirkIds.length + c.character.userStateIds.length + c.character.boundaryRuleIds.length;
    if (c.character.identityGuardrails) n++;
    if (c.character.identityRecoveryStyle) n++;
    if (c.character.fallbackDeflections) n++;
    return `${n} rules`;
  }
  if (id === 'knowledge') {
    const sources = c.character.knowledgeSources?.length ?? 0;
    return `${c.character.knowledgeSpecializationIds.length} weighted${sources ? ` · ${sources} src` : ''}`;
  }
  let fiction = Object.keys(c.character.customProperties || {}).length;
  if (c.character.deliberationProfile) fiction++;
  if (c.character.availabilityProfile) fiction++;
  if (c.character.deliveryPattern) fiction++;
  return `${fiction} custom`;
}

function FolderTabs({
  active,
  onPick,
}: {
  active: StationId;
  onPick: (id: StationId) => void;
}) {
  return (
    <Row style={{ gap: 0, alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap', marginBottom: -1 }}>
      {STATIONS.map((s) => {
        const isActive = active === s.id;
        return (
          <Pressable
            key={s.id}
            onPress={() => onPick(s.id)}
            style={{
              paddingTop: isActive ? 12 : 9,
              paddingBottom: isActive ? 12 : 9,
              paddingLeft: 14,
              paddingRight: 14,
              backgroundColor: isActive ? 'theme:paper' : 'theme:paperAlt',
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderBottomWidth: isActive ? 0 : 1,
              borderColor: isActive ? 'theme:paperRuleBright' : 'theme:paperRule',
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              marginRight: 4,
            }}
          >
            <Text
              noWrap
              fontSize={12}
              fontWeight={isActive ? '700' : '600'}
              color={isActive ? 'theme:paperInk' : 'theme:paperInkDim'}
              style={{
                letterSpacing: 0,
              }}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

function StationHeader({ active }: { active: StationId }) {
  const c = useCharacter();
  const station = STATIONS.find((s) => s.id === active) || STATIONS[0];
  return (
    <Col style={{ width: '100%', gap: 6, marginBottom: 14 }}>
      <Text fontSize={10} fontWeight="700" color="theme:paperInk" style={{ letterSpacing: 1 }}>
        CHARACTER STUDIO
      </Text>
      <Row style={{ width: '100%', gap: 12, alignItems: 'center' }}>
        <Text fontSize={26} fontWeight="700" color="theme:paperInk">
          {station.label}
        </Text>
        <Box style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          borderWidth: 1,
          borderColor: 'theme:paperRuleBright',
          borderRadius: 4,
        }}>
          <Text fontSize={11} color="theme:paperInk">{stationMetric(active, c)}</Text>
        </Box>
      </Row>
      <Text fontSize={12} color="theme:paperInkDim">{station.kicker}</Text>
    </Col>
  );
}

function StationWorkbench({ active }: { active: StationId }) {
  if (active === 'identity') {
    return (
      <Col style={{ width: '100%', gap: 12 }}>
        <IdentitySection />
        <EmbodimentSection />
        <RelationshipProjectionSection />
        <BackstorySection />
        <ContinuitySeedSection />
        <AdvancedRoutingSection />
      </Col>
    );
  }
  if (active === 'purpose') {
    return (
      <Col style={{ width: '100%', gap: 12 }}>
        <TaskDomainsSection />
        <RelationshipRegisterSection />
        <StakesSection />
      </Col>
    );
  }
  if (active === 'voice') {
    return (
      <Col style={{ width: '100%', gap: 12 }}>
        <ArchetypeSection />
        <DialsSection />
      </Col>
    );
  }
  if (active === 'behavior') {
    return (
      <Col style={{ width: '100%', gap: 12 }}>
        <QuirksSection />
        <StanceTriadSection />
        <UserStateSection />
        <BoundariesSection />
        <IdentityIntegritySection />
      </Col>
    );
  }
  if (active === 'knowledge') {
    return (
      <Col style={{ width: '100%', gap: 12 }}>
        <KnowledgeSection />
        <KnowledgeSourcesSection />
      </Col>
    );
  }
  return (
    <Col style={{ width: '100%', gap: 12 }}>
      <RoleplayIdentitySection />
      <DeliveryPatternSection />
      <CustomPropertiesSection />
    </Col>
  );
}

function CharacterForm() {
  const c = useCharacter();
  const [activeStation, setActiveStation] = useState<StationId>('voice');
  // Single master timeline. All page-level fades + section springs read
  // ranges off this one RAF loop.
  const tl = useAnimationTimeline();
  if (c.loading) {
    return (
      <S.Page>
        <Box style={{ padding: 28, opacity: tl.range(0, 200, 'easeOutCubic') }}>
          <S.Caption>Loading character…</S.Caption>
        </Box>
      </S.Page>
    );
  }

  // Page Fade — the content-area fades in as a route swap.
  const pageOp = tl.range(0, PAGE_FADE_MS, 'easeOutCubic');
  // Heading Fade — slightly quicker than the page fade; lands first.
  const headOp = tl.range(0, HEAD_DUR_MS, 'easeOutCubic');
  const workbenchOp = tl.range(140, 140 + SECTION_DUR_MS, 'easeOutBack');
  return (
    <S.Page>
      <Row style={{
        width: '100%', height: '100%', alignItems: 'stretch', minWidth: 0,
        borderWidth: 4, borderColor: 'rgba(0,255,255,1)',
      }}>
        <ScrollView
          debugName="char-scroll"
          onScroll={(e: any) => {
            const host: any = globalThis;
            const cnt = (host.__tel_node_count && host.__tel_node_count()) | 0;
            let scr: any = null, yel: any = null;
            for (let i = 0; i < cnt; i++) {
              const n = host.__tel_node && host.__tel_node(i);
              if (!n) continue;
              if (n.tag === 'char-scroll') scr = n;
              else if (n.tag === 'char-yellow') yel = n;
              if (scr && yel) break;
            }
            console.log('[char-scroll]', JSON.stringify({
              wY: e?.scrollY,
              dY: e?.deltaY,
              scrCH: scr?.content_height,
              scrH: scr?.h,
              max: scr ? Math.max(0, scr.content_height - scr.h) : null,
              yelH: yel?.h,
              yelY: yel?.y,
              yelB: yel ? yel.y + yel.h : null,
              scrB: scr ? scr.y + scr.h : null,
              gap: (scr && yel) ? (scr.y + scr.h) - (yel.y + yel.h) : null,
            }));
          }}
          style={{
            flexGrow: 1, flexBasis: 0, minWidth: 0,
            paddingTop: 28, paddingBottom: 28,
            paddingLeft: 28, paddingRight: 14,
            alignItems: 'center',
            opacity: pageOp,
            borderWidth: 4, borderColor: 'rgba(0,128,255,1)',
            backgroundColor: 'rgba(0,128,255,0.10)',
          }}
        >
            <Box
              debugName="char-yellow"
              style={{
                width: '100%', maxWidth: 1040,
                minWidth: 0, overflow: 'hidden',
                borderWidth: 4, borderColor: 'rgba(255,255,0,1)',
                backgroundColor: 'rgba(255,255,0,0.06)',
              }}
            >
              <Box style={{ opacity: headOp }}>
                <Row style={{ width: '100%', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                  <Col style={{ gap: 4 }}>
                    <S.Title>CHARACTER</S.Title>
                    <S.Caption>{c.character.displayName || c.character.name || 'Unnamed assistant'}</S.Caption>
                  </Col>
                  <SaveBar />
                </Row>
              </Box>
              <FolderTabs active={activeStation} onPick={setActiveStation} />
              <S.DocPageWrap style={{ width: '100%', padding: 0, flexGrow: 0, flexShrink: 0 }}>
                <S.DocPage style={{ width: '100%', flexGrow: 0, flexShrink: 0 }}>
                  <S.DocPageContent style={{ width: '100%', flexGrow: 0, flexShrink: 0 }}>
                    <StationHeader active={activeStation} />
                    <Stagger progress={workbenchOp}>
                      <StationWorkbench active={activeStation} />
                    </Stagger>
                  </S.DocPageContent>
                </S.DocPage>
              </S.DocPageWrap>
              {/* Bottom spacer — DEBUG. magenta=200, lime=30. If the
                  10-15px overscroll gap disappears now, the missing
                  pixels were a constant inset; if the gap is still
                  there, content_height is short by the same constant
                  every time and we're chasing something else. */}
              <Box style={{ width: '100%', height: 200, backgroundColor: 'magenta' }} />
              <Box style={{ width: '100%', height: 30, backgroundColor: 'lime' }} />
            </Box>
        </ScrollView>

        <Box style={{
          width: 360,
          height: '100%',
          paddingTop: 18, paddingBottom: 18,
          paddingLeft: 14, paddingRight: 28,
          overflow: 'hidden',
          opacity: pageOp,
        }}>
          <AvatarPreview />
        </Box>
      </Row>
    </S.Page>
  );
}

export default function CharacterPage() {
  return (
    <CharacterProvider>
      <CharacterForm />
    </CharacterProvider>
  );
}
