import { Box, Col, Row, Text } from '../../../runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import {
  ArchetypeGallery,
  BlockFaces,
  FrameAtlas,
  GeneratorBoard,
  LifecycleSchedules,
  LiveFace,
  ScaleShowcase,
  StaticFace,
  StripRow,
  VariationGrid,
  archetypeForWorker,
  blockFacesAccessoryIds,
  blockFacesArchetypes,
  blockFacesHairColors,
  blockFacesHairShapesHuman,
  blockFacesHairShapesHumanFem,
  blockFacesSkinTones,
} from '../components/block-faces/BlockFaces';
import { workerMockData } from '../data/core/worker';
import type { Worker, WorkerLifecycle } from '../data/core/worker';

const COLORS = {
  bg: 'theme:bg',
  bg1: 'theme:bg1',
  rule: 'theme:rule',
  ink: 'theme:ink',
  inkDim: 'theme:inkDim',
  inkDimmer: 'theme:inkDimmer',
  accent: 'theme:accent',
  ok: 'theme:ok',
  warn: 'theme:warn',
  flag: 'theme:flag',
  blue: 'theme:blue',
  lilac: 'theme:lilac',
};

function makeWorker(overrides: Partial<Worker>): Worker {
  return {
    id: 'mock_worker',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    settingsId: 'settings_default',
    label: 'Mock',
    kind: 'primary',
    lifecycle: 'active',
    connectionId: 'conn_claude_cli',
    modelId: 'claude-opus-4-7',
    maxConcurrentRequests: 1,
    spawnedAt: '2026-04-28T13:03:00Z',
    ...overrides,
  };
}

const ROSTER: Worker[] = [
  makeWorker({ id: 'frank',  label: 'frank',  modelId: 'opus 4.7', lifecycle: 'crashed' }),
  makeWorker({ id: 'echo',   label: 'echo',   modelId: 'gpt 5.4',  lifecycle: 'streaming', kind: 'subagent' }),
  makeWorker({ id: 'morag',  label: 'morag',  modelId: 'kimi k2',  lifecycle: 'suspended' }),
  makeWorker({ id: 'wren',   label: 'wren',   modelId: 'opus 4.7', lifecycle: 'active' }),
  makeWorker({ id: 'vesper', label: 'vesper', modelId: 'sonnet 4.6', lifecycle: 'idle' }),
  makeWorker({ id: 'orin',   label: 'orin',   modelId: 'haiku 4.5', lifecycle: 'streaming' }),
  makeWorker({ id: 'ash',    label: 'ash',    modelId: 'gpt 4.1',  lifecycle: 'terminated' }),
];

function Card({ title, meta, children, width = 800 }: { title: string; meta?: string; children: any; width?: number }) {
  return (
    <Col
      style={{
        backgroundColor: COLORS.bg1,
        borderWidth: 1,
        borderColor: COLORS.rule,
        padding: 14,
        gap: 10,
        width,
        maxWidth: '100%',
      }}
    >
      <Row style={{ justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingBottom: 6 }}>
        <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.accent, fontWeight: 'bold', letterSpacing: 2 }}>
          {title.toUpperCase()}
        </Text>
        {meta ? (
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer, letterSpacing: 1 }}>{meta}</Text>
        ) : null}
      </Row>
      {children}
    </Col>
  );
}

function PaletteSwatch({ ch, color, name }: { ch: string; color: string; name: string }) {
  return (
    <Col style={{ alignItems: 'center', gap: 2 }}>
      <Box style={{ width: 18, height: 18, backgroundColor: color, borderWidth: 1, borderColor: COLORS.rule }} />
      <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ink, fontWeight: 'bold' }}>{ch}</Text>
      <Text style={{ fontFamily: 'monospace', fontSize: 8, color: COLORS.inkDimmer, letterSpacing: 1 }}>{name}</Text>
    </Col>
  );
}

function PaletteCard() {
  const groups: { ttl: string; keys: Array<[string, string, string]> }[] = [
    { ttl: 'skin / shell', keys: [
      ['L', 'theme:inkDim', 'skin lt'], ['s', 'theme:inkDim', 'skin'], ['S', 'theme:paperInkDim', 'skin sh'],
      ['z', 'theme:paperInkDim', 'rot'], ['Z', 'theme:inkGhost', 'rot sh'], ['v', 'theme:inkDim', 'sick'],
    ]},
    { ttl: 'hair / outline', keys: [
      ['h', 'theme:rule', 'hair'], ['H', 'theme:inkGhost', 'hair2'], ['x', 'theme:bg', 'outline'], ['X', 'theme:rule', 'soft'],
    ]},
    { ttl: 'eyes / lights', keys: [
      ['w', 'theme:ink', 'white'], ['i', 'theme:blue', 'iris·b'], ['I', 'theme:ok', 'iris·t'],
      ['p', 'theme:bg', 'pupil'], ['b', 'theme:blue', 'lt·b'], ['c', 'theme:ok', 'lt·c'], ['l', 'theme:lilac', 'lt·l'],
    ]},
    { ttl: 'metal / chrome', keys: [
      ['K', 'theme:bg2', 'deep'], ['k', 'theme:rule', 'seam'], ['g', 'theme:inkDimmer', 'metal'],
      ['G', 'theme:inkDim', 'metal lt'], ['W', 'theme:ink', 'spec'],
    ]},
    { ttl: 'signal', keys: [
      ['o', 'theme:accent', 'accent'], ['y', 'theme:warn', 'warn'], ['r', 'theme:flag', 'flag'],
      ['m', 'theme:paperRuleBright', 'mouth'], ['M', 'theme:accent', 'mouth on'],
    ]},
    { ttl: 'brain / ghost', keys: [
      ['q', 'theme:flag', 'brain'], ['Q', 'theme:paperRuleBright', 'brain sh'],
      ['e', 'theme:inkDim', 'ghost'], ['E', 'theme:inkDimmer', 'ghost mid'],
    ]},
  ];
  return (
    <Card title="Palette · 1 char = 1 cell" meta="cockpit token-aligned">
      <Col style={{ gap: 10 }}>
        {groups.map((g) => (
          <Col key={g.ttl} style={{ gap: 4 }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 8, color: COLORS.inkDimmer, letterSpacing: 2 }}>
              {g.ttl.toUpperCase()}
            </Text>
            <Row style={{ gap: 8, flexWrap: 'wrap' }}>
              {g.keys.map(([ch, col, nm]) => (
                <PaletteSwatch key={ch} ch={ch} color={col} name={nm} />
              ))}
            </Row>
          </Col>
        ))}
      </Col>
    </Card>
  );
}

function AnatomyCard() {
  return (
    <Card title="Anatomy · 16×16 grid" meta="symmetric · stacked frames">
      <Row style={{ gap: 14, alignItems: 'flex-start' }}>
        <Col style={{ alignItems: 'center', gap: 6 }}>
          <StaticFace archetype="human" frame="idle" scale={14} />
          <Row style={{ gap: 14 }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.blue, letterSpacing: 1 }}>■ HEAD</Text>
            <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ok, letterSpacing: 1 }}>■ EYES</Text>
            <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.accent, letterSpacing: 1 }}>■ MOUTH</Text>
          </Row>
        </Col>
        <Col style={{ gap: 8, flexGrow: 1, minWidth: 200 }}>
          <Text style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.ink }}>
            16×16 of 1:1 cells.
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
            row 1–4 — hair / cap / antenna / brain
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
            row 5 — head top edge
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.ok }}>
            row 6–8 — eye band (whites · iris · pupil)
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
            row 9 — cheek / nose
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.accent }}>
            row 10–12 — mouth band
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
            row 13–14 — chin / collar
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer, marginTop: 6 }}>
            Symmetric on the vertical axis.
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.inkDimmer }}>
            Asymmetry (scar, glow eye) is a deliberate variant tell.
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.accent, marginTop: 4 }}>
            Frames are stacked specs sharing the same grid.
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.accent }}>
            Animation = swap frame; nothing tweens.
          </Text>
        </Col>
      </Row>
    </Card>
  );
}

function StateOverlaysCard() {
  const lifecycles: WorkerLifecycle[] = ['idle', 'active', 'streaming', 'suspended', 'crashed'];
  return (
    <Card title="States · portrait + cockpit pip" meta="lifecycle-driven">
      <Row style={{ gap: 14, flexWrap: 'wrap' }}>
        {lifecycles.map((lc) => (
          <BlockFaces
            key={lc}
            row={makeWorker({ id: `state-${lc}`, label: lc, lifecycle: lc })}
            layout="portrait"
            scale={5}
          />
        ))}
      </Row>
      <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
        The portrait stays stable; only the state label moves.
      </Text>
      <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
        The face's own animation reads as liveness; the label carries the cockpit's actual semantic state.
      </Text>
    </Card>
  );
}

function CastNotes() {
  const cast: Array<[string, string]> = [
    ['human',   'baseline. hair, eyes, mouth — the control.'],
    ['robot',   'chassis with two indicator-light eyes; speaker grille mouth lights orange when talking.'],
    ['zombie',  'exposed brain on top, mismatched eyes, snaggle mouth. brain pulses red as a third frame.'],
    ['cyclops', 'single large iris that fills the eye band; reads as focused.'],
    ['ghost',   'translucent column with wispy bottom edge that animates.'],
    ['visor',   'head with full-width visor; scan-line frame sweeps orange.'],
    ['skull',   'minimal · for retired or "rat" workers · fire-eye frame.'],
    ['skins',   'Block Builder, Green Hisser, Void Walker, panda, bear, cat, dog, parrot, bird, skeleton, witch, Italian Man, Web Hero, Night Cowl, Metal Bro, Grinning Mask, Green Frog, Robed Teacher.'],
  ];
  return (
    <Card title="Cast · expanded skin set" meta={`${blockFacesArchetypes.length} silhouettes · color second`}>
      <Col style={{ gap: 6 }}>
        {cast.map(([k, desc]) => (
          <Row key={k} style={{ gap: 8 }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.accent, fontWeight: 'bold', width: 70 }}>
              {k}
            </Text>
            <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim, flexGrow: 1 }}>
              {desc}
            </Text>
          </Row>
        ))}
      </Col>
    </Card>
  );
}

const FEATURED_SKINS = [
  { id: 'blockBuilder', label: 'Block Builder' },
  { id: 'greenHisser', label: 'Green Hisser' },
  { id: 'voidWalker', label: 'Void Walker' },
  { id: 'panda', label: 'Panda' },
  { id: 'bear', label: 'Bear' },
  { id: 'cat', label: 'Cat' },
  { id: 'dog', label: 'Dog' },
  { id: 'parrot', label: 'Parrot' },
  { id: 'bird', label: 'Bird' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'witch', label: 'Witch' },
  { id: 'italianMan', label: 'Italian Man' },
  { id: 'webHero', label: 'Web Hero' },
  { id: 'nightCowl', label: 'Night Cowl' },
  { id: 'metalBro', label: 'Metal Bro' },
  { id: 'grinningMask', label: 'Grinning Mask' },
  { id: 'greenFrog', label: 'Green Frog' },
  { id: 'robedTeacher', label: 'Robed Teacher' },
] as const;

function FeaturedSkinsCard() {
  return (
    <Card title="Named skins · block-face wall" meta="16×16 static silhouette + live frame">
      <Row style={{ gap: 8, flexWrap: 'wrap' }}>
        {FEATURED_SKINS.map((skin) => (
          <Col
            key={skin.id}
            style={{
              alignItems: 'center',
              gap: 4,
              paddingTop: 8,
              paddingBottom: 6,
              paddingLeft: 6,
              paddingRight: 6,
              backgroundColor: COLORS.bg,
              borderWidth: 1,
              borderColor: COLORS.rule,
              width: 104,
            }}
          >
            <LiveFace archetype={skin.id} scale={4} seed={skin.id} />
            <Text style={{ fontFamily: 'monospace', fontSize: 8, color: COLORS.ink, fontWeight: 'bold' }}>
              {skin.label}
            </Text>
            <Text style={{ fontFamily: 'monospace', fontSize: 7, color: COLORS.inkDimmer, letterSpacing: 1 }}>
              {skin.id}
            </Text>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

const GENERATOR_NAMES = [
  'frank',  'echo',   'morag',  'wren',
  'vesper', 'orin',   'ash',    'lyra',
  'kai',    'sable',  'thorn',  'wisp',
  'halo',   'pike',   'rune',   'moth',
  'blockBuilder',  'greenHisser', 'voidWalker', 'panda',
  'bear',   'cat',     'dog',      'parrot',
  'bird',   'skeleton','witch',    'italianMan',
  'webHero', 'nightCowl', 'metalBro', 'grinningMask',
  'greenFrog',   'robedTeacher',
];

export const blockFacesSection = defineGallerySection({
  id: 'block-faces',
  title: 'Block Faces',
  group: {
    id: 'controls',
    title: 'Controls & Cards',
  },
  kind: 'atom',
  stories: [
    defineGalleryStory({
      id: 'block-faces/default',
      title: 'Block Faces · worker tile',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'tile-active',
          name: 'Tile · streaming subagent',
          render: () => <BlockFaces row={workerMockData[1]} />,
        },
        {
          id: 'tile-supervisor',
          name: 'Tile · supervisor',
          render: () => <BlockFaces row={workerMockData[0]} />,
        },
        {
          id: 'tile-idle',
          name: 'Tile · idle reviewer',
          render: () => <BlockFaces row={workerMockData[3]} />,
        },
        {
          id: 'tile-roster',
          name: 'Tile · named roster',
          render: () => (
            <Col style={{ gap: 8 }}>
              {ROSTER.slice(0, 4).map((row) => (
                <BlockFaces key={row.id} row={row} />
              ))}
            </Col>
          ),
        },
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/system',
      title: 'Block Faces · system',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'anatomy',
          name: 'Anatomy · 16×16 grid',
          render: () => <AnatomyCard />,
        },
        {
          id: 'palette',
          name: 'Palette',
          render: () => <PaletteCard />,
        },
        {
          id: 'cast',
          name: 'Cast notes',
          render: () => <CastNotes />,
        },
        {
          id: 'named-skins',
          name: 'Named skin wall',
          render: () => <FeaturedSkinsCard />,
        },
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/archetypes',
      title: 'Block Faces · archetypes',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'gallery',
          name: 'Live archetype gallery',
          render: () => (
            <Card title="Archetypes · live" meta={`${blockFacesArchetypes.length} skins · animated`}>
              <ArchetypeGallery rows={ROSTER} />
            </Card>
          ),
        },
        ...blockFacesArchetypes.map((arch) => ({
          id: `frames-${arch}`,
          name: `Frames · ${arch}`,
          render: () => <FrameAtlas archetype={arch} seed={arch} />,
        })),
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/scale',
      title: 'Block Faces · scale',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: blockFacesArchetypes.map((arch) => ({
        id: `scale-${arch}`,
        name: `Scale · ${arch} · 16→96px`,
        render: () => <ScaleShowcase archetype={arch} seed={arch} />,
      })),
    }),
    defineGalleryStory({
      id: 'block-faces/states',
      title: 'Block Faces · states',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'lifecycle-overlays',
          name: 'Lifecycle overlays · idle/active/streaming/suspended/crashed',
          render: () => <StateOverlaysCard />,
        },
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/lifecycle-schedules',
      title: 'Block Faces · lifecycle schedules',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'human-all-lifecycles',
          name: 'human · 8 lifecycles, schedule-only diff',
          render: () => (
            <Card title="Lifecycle schedules · human" meta="same face · timing-driven">
              <LifecycleSchedules archetype="human" seed="frank" />
              <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
                Same archetype, same seed — only the schedule changes per lifecycle.
                Streaming workers talk constantly, suspended workers freeze on a single
                frame, terminated workers don't blink. The frame names a worker uses are
                resolved from a fallback list, so skull's "fire" stands in where human
                has "talk".
              </Text>
            </Card>
          ),
        },
        ...blockFacesArchetypes.map((arch) => ({
          id: `lifecycle-${arch}`,
          name: `${arch} · 8 lifecycles`,
          render: () => (
            <Card title={`Lifecycle schedules · ${arch}`} meta="schedule-driven animation">
              <LifecycleSchedules archetype={arch} seed={arch} />
            </Card>
          ),
        })),
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/variations',
      title: 'Block Faces · variations',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'human-16',
          name: 'human · 16 seeded variations',
          render: () => (
            <Card title="Variations · human" meta={`${blockFacesHairShapesHuman.length} hair × ${blockFacesAccessoryIds.length} accessory × ${blockFacesSkinTones} skin × ${blockFacesHairColors} hair-color`}>
              <VariationGrid
                archetype="human"
                seeds={['frank','kai','rex','milo','dax','jude','otis','bram','remy','arlo','flynn','iggy','jove','linus','niko','quinn']}
              />
              <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
                Same archetype, 16 different seeds. Hair shape (mohawk · spikes · bald · afro · top-hat · beanie · long · flat-top), face accessory (glasses · sunglasses · mustache · beard · goatee · cigarette · eyepatch · monocle · earring · scar · mole · freckles · beauty), and tones all roll independently per name.
              </Text>
            </Card>
          ),
        },
        {
          id: 'humanFem-16',
          name: 'humanFem · 16 seeded variations',
          render: () => (
            <Card title="Variations · humanFem" meta="long-hair frames · lipstick mouth · seeded mutations">
              <VariationGrid
                archetype="humanFem"
                seeds={['lyra','sable','vesper','halo','rune','moth','morag','iris','luna','nova','tess','wren','pia','zora','elke','mira']}
              />
              <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
                Distinct base frames (longer hair, lipstick mouth, smile frame) plus the
                same generative pass — accessories and tones layer the same way.
              </Text>
            </Card>
          ),
        },
        {
          id: 'robot-16',
          name: 'robot · 16 chassis variations',
          render: () => (
            <Card title="Variations · robot" meta="indicator color seeded per name">
              <VariationGrid
                archetype="robot"
                seeds={['echo','tau','nyx','zip','arc','vex','hex','ion','quad','flux','pulse','glyph','byte','riv','watt','onyx']}
              />
              <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
                Robots skip skin/hair/accessory but still get unique indicator-light
                colors per seed — paired chassis read distinct at strip scale.
              </Text>
            </Card>
          ),
        },
        {
          id: 'mixed-archetypes',
          name: 'mixed · 12 names across all archetypes',
          render: () => (
            <Card title="Variations · mixed" meta={`archetype = hash(name) % ${blockFacesArchetypes.length} + named overrides`}>
              <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                {['frank','lyra','echo','morag','wren','vesper','orin','ash','blockBuilder','greenHisser','voidWalker','panda','cat','dog','italianMan','webHero','metalBro','robedTeacher'].map((nm) => {
                  const arch = archetypeForWorker({
                    id: nm, label: nm, lifecycle: 'active',
                    userId: '', workspaceId: '', settingsId: '', kind: 'primary',
                    connectionId: '', modelId: '', maxConcurrentRequests: 1, spawnedAt: '',
                  });
                  return (
                    <Col key={nm} style={{ alignItems: 'center', gap: 3, padding: 6, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.rule, width: 96 }}>
                      <LiveFace archetype={arch} scale={4} seed={nm} />
                      <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ink }}>{nm}</Text>
                      <Text style={{ fontFamily: 'monospace', fontSize: 7, color: COLORS.inkDimmer, letterSpacing: 1 }}>{arch}</Text>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          ),
        },
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/strip',
      title: 'Block Faces · strip',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'roster-strip',
          name: 'Strip · roster · echo focused',
          render: () => (
            <Card title="Strip · 32px portraits" meta="bottom-bar slot">
              <StripRow rows={ROSTER} focusId="echo" />
              <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
                Even at 32px the silhouettes stay distinct: cyclops' single iris, robot's lights, zombie's brain,
                visor's band. Silhouette first, color second.
              </Text>
            </Card>
          ),
        },
        {
          id: 'mock-strip',
          name: 'Strip · seeded mockData',
          render: () => (
            <Card title="Strip · workerMockData" meta="seeded archetypes">
              <StripRow rows={workerMockData} focusId={workerMockData[1].id} />
            </Card>
          ),
        },
      ],
    }),
    defineGalleryStory({
      id: 'block-faces/generator',
      title: 'Block Faces · generator',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      tags: ['card', 'motion'],
      variants: [
        {
          id: 'roster-expanded',
          name: 'expanded roster · deterministic from name',
          render: () => (
            <Card title="Generator · session-spawned" meta="archetype = hash(name)">
              <GeneratorBoard names={GENERATOR_NAMES} />
              <Text style={{ fontFamily: 'monospace', fontSize: 10, color: COLORS.inkDim }}>
                Archetype = hash(name) % {blockFacesArchetypes.length}, stable forever for a given name.
                Requested names get direct overrides; palette mutation still keeps generic humans and chassis distinct.
              </Text>
            </Card>
          ),
        },
        {
          id: 'mock-data',
          name: 'workerMockData · seeded portraits',
          render: () => (
            <Card title="Generator · workerMockData" meta="seeded from row.id">
              <Row style={{ gap: 10, flexWrap: 'wrap' }}>
                {workerMockData.map((row) => {
                  const arch = archetypeForWorker(row);
                  return (
                    <Col
                      key={row.id}
                      style={{
                        alignItems: 'center',
                        gap: 4,
                        paddingTop: 8,
                        paddingBottom: 6,
                        paddingLeft: 6,
                        paddingRight: 6,
                        backgroundColor: COLORS.bg,
                        borderWidth: 1,
                        borderColor: COLORS.rule,
                        width: 120,
                      }}
                    >
                      <LiveFace archetype={arch} scale={5} seed={row.id} />
                      <Text style={{ fontFamily: 'monospace', fontSize: 9, color: COLORS.ink, fontWeight: 'bold' }}>
                        {row.label}
                      </Text>
                      <Text style={{ fontFamily: 'monospace', fontSize: 8, color: COLORS.inkDimmer, letterSpacing: 1 }}>
                        {arch}
                      </Text>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          ),
        },
      ],
    }),
  ],
});
