// TextureStudio — the /textures route: where textures are MADE.
//
//   ┌────────────────┬──────────────────────────────────┐
//   │  CATALOG rail   │  shader selected → ShaderLab      │
//   │  HMSC · Game    │  (tune named params, no magic     │
//   │  A · Environment│   numbers, then MATERIALIZE)      │
//   │  …boards…       ├──────────────────────────────────┤
//   │  REACT (code)   │  SAVED MATERIALS strip            │
//   │  SAVED          │  (live swatches · id · delete)    │
//   └────────────────┴──────────────────────────────────┘
//
// The texture pipeline in one surface (the locked art→material vocabulary):
//   • a SHADER is a tunable WGSL recipe from game/textures/shaders.ts — every
//     parameter is named + range-bounded (the no-magic-numbers rule), canvas is
//     exactly 1 tile;
//   • MATERIALIZE freezes the current values into a stored material
//     (game/textures/materials.ts, persisted in the shared 'hmsc' store) under
//     the name typed in SAVE AS;
//   • the stored material joins the one texture registry (allTextures), so it is
//     immediately assignable everywhere — part picking, tiles, faces — and the
//     game bakes it through the normal TextureCapture path.
//   • REACT textures (the building skins) are the other authoring kind — laid out
//     in code, browsable here as previews. Authoring those stays a code task.

import { useEffect, useMemo } from 'react';
import { Box, Col, Effect, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { shaderGroups, shaderSpec, type ShaderSpec } from '@game/textures/shaders';
import { TEXTURE_REGISTRY, textureById } from '@game/textures/registry';
import { removeCustomTexture, saveCustomTexture, useCustomTextures, type CustomTexture } from '@game/textures/materials';
import { ShaderLab } from './ShaderLab';
import { TexturePreview } from './TexturePreview';
import { accentFor } from './studio.cls';
import { editorChannel } from './editors/store';
import { editorSessions, type RouteSession } from './editors/sessions';
import { materialsStream, type MaterialsEvent } from './editors/materials/stream';
import { useRouteTwigState } from './editors/twigs';

type Sel =
  | { kind: 'shader'; id: string }
  | { kind: 'react'; id: string }
  | { kind: 'custom'; id: string };

function RailHeader(props: { title: string; count: number }) {
  return (
    <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 9, paddingBottom: 3 }}>
      <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1 }}>{props.title.toUpperCase()}</Text>
      <Box style={{ flexGrow: 1 }} />
      <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{String(props.count)}</Text>
    </Row>
  );
}

function RailItem(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ height: 24, justifyContent: 'center', paddingLeft: 14, paddingRight: 8, backgroundColor: props.on ? accentFor('bgElevated') : 'transparent', borderLeftWidth: 2, borderLeftColor: props.on ? accentFor('primary') : '#00000000' }}>
      <Text fontSize={11} color={props.on ? accentFor('text') : accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: props.on ? 700 : 500 }} numberOfLines={1}>{props.label}</Text>
    </Pressable>
  );
}

// One saved material in the strip: live swatch + label + the id a part/tile
// references + delete. The swatch renders the recipe's shader with the frozen data.
function SavedSwatch(props: { tex: CustomTexture; on: boolean; onPress: () => void; onDelete: () => void }) {
  const spec = shaderSpec(props.tex.shaderId);
  return (
    <Col style={{ alignItems: 'center', gap: 3, width: 84 }}>
      <Pressable onPress={props.onPress} style={{ width: 56, height: 56, borderRadius: 4, borderWidth: 1, borderColor: props.on ? accentFor('primary') : accentFor('border'), overflow: 'hidden' }}>
        {spec ? <Effect shader={spec.shader} data={props.tex.data} style={{ width: '100%', height: '100%' }} /> : null}
      </Pressable>
      <Text fontSize={8} color={accentFor('text')} style={{ fontFamily: 'monospace' }} numberOfLines={1}>{props.tex.label}</Text>
      <Pressable onPress={props.onDelete} style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderRadius: 3, borderWidth: 1, borderColor: accentFor('border') }}>
        <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>delete</Text>
      </Pressable>
    </Col>
  );
}

export function TextureStudio() {
  const groups = useMemo(() => shaderGroups(), []);
  const reactTextures = useMemo(() => TEXTURE_REGISTRY.filter((t) => t.source.kind === 'react'), []);
  const customs = useCustomTextures();

  const [sel, setSel] = useRouteTwigState<Sel>('/textures', 'selection', { kind: 'shader', id: groups[0].specs[0].id });
  const [saveAs, setSaveAs] = useRouteTwigState('/textures', 'saveAs', '');

  // ── the V20 channel + this visit's session (AUTOSAVE-0605): every
  // Materialize/delete lands as its own labeled commit on the materials
  // channel (the legacy localstore keeps serving renderers unchanged —
  // the stream is the chain's truth + snapshot the future materials
  // editor inherits). ────────────────────────────────────────────────────────
  const live = useMemo(() => {
    try {
      const channel = editorChannel(materialsStream);
      return { channel, session: editorSessions().open('/textures', channel) as RouteSession<MaterialsEvent>, error: null as string | null };
    } catch (e) {
      return { channel: null, session: null, error: String(e) };
    }
  }, []);
  useEffect(() => () => live.session?.close(), [live]);

  const selSpec: ShaderSpec | undefined = sel.kind === 'shader' ? shaderSpec(sel.id) : undefined;
  const selDef = sel.kind !== 'shader' ? textureById(sel.id) : undefined;

  // Materialize → persist as a stored material. The typed SAVE AS name wins; an
  // empty field falls back to the lab's suggested recipe/take name. The commit
  // IS the autosave: Materialize is the route's authoring interaction.
  const persist = (suggested: string, data: number[]) => {
    if (!selSpec) return;
    const saved = saveCustomTexture(saveAs.trim() || suggested, selSpec.id, data);
    live.session?.commit(
      { kind: 'materialized', material: { id: saved.id, label: saved.label, shaderId: selSpec.id, data: [...data] } },
      `materialized · ${saved.label} (${selSpec.id})`,
    );
    setSaveAs('');
    setSel({ kind: 'custom', id: saved.id });
  };

  const removeMaterial = (id: string) => {
    removeCustomTexture(id);
    live.session?.commit({ kind: 'removed', id }, `${id}: deleted`);
  };

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: accentFor('bg') }}>
      {/* Catalog rail */}
      <Box style={{ width: 200, height: '100%', borderRightWidth: 1, borderRightColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
        <ScrollView style={{ width: '100%', height: '100%' }} contentContainerStyle={{ paddingBottom: 12 }}>
          {groups.map((g) => (
            <Col key={g.group}>
              <RailHeader title={g.group} count={g.specs.length} />
              {g.specs.map((s) => (
                <RailItem key={s.id} label={s.label} on={sel.kind === 'shader' && sel.id === s.id} onPress={() => setSel({ kind: 'shader', id: s.id })} />
              ))}
            </Col>
          ))}
          <RailHeader title="React (code)" count={reactTextures.length} />
          {reactTextures.map((t) => (
            <RailItem key={t.id} label={t.label} on={sel.kind === 'react' && sel.id === t.id} onPress={() => setSel({ kind: 'react', id: t.id })} />
          ))}
          <RailHeader title="Saved" count={customs.length} />
          {customs.map((t) => (
            <RailItem key={t.id} label={t.label} on={sel.kind === 'custom' && sel.id === t.id} onPress={() => setSel({ kind: 'custom', id: t.id })} />
          ))}
        </ScrollView>
      </Box>

      {/* Workbench */}
      <Col style={{ flexGrow: 1, minWidth: 0, height: '100%' }}>
        {selSpec ? (
          <>
            {/* Save-as bar: name the material MATERIALIZE will store. */}
            <Row style={{ height: 34, flexShrink: 0, alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
              <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{selSpec.group} · {selSpec.label}</Text>
              <Box style={{ flexGrow: 1 }} />
              <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>save as</Text>
              <TextInput value={saveAs} onChangeText={setSaveAs} placeholder={`${selSpec.id}/…`} style={{ width: 200, backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), color: accentFor('text'), paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }} />
            </Row>
            <Box style={{ flexGrow: 1, minHeight: 0 }}>
              <ShaderLab spec={selSpec} onMaterialize={persist} />
            </Box>
          </>
        ) : selDef ? (
          <TexturePreview def={selDef} caption={sel.kind === 'react' ? `${selDef.label} · 2D-react texture (authored in code)` : `${selDef.label} · stored material · id ${selDef.id}`} />
        ) : (
          <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text fontSize={11} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>pick a recipe on the left</Text>
          </Box>
        )}

        {/* Saved-materials strip: every stored material, live, with its id. */}
        <Box style={{ height: 104, flexShrink: 0, borderTopWidth: 1, borderTopColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
          <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1, paddingLeft: 10, paddingTop: 6 }}>SAVED MATERIALS ({customs.length}) — assignable everywhere a texture is</Text>
          <ScrollView horizontal style={{ flexGrow: 1 }} contentContainerStyle={{ flexDirection: 'row', gap: 10, padding: 8, alignItems: 'flex-start' }}>
            {customs.length === 0 ? (
              <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>tune a recipe, then MATERIALIZE to store it →</Text>
            ) : customs.map((t) => (
              <SavedSwatch key={t.id} tex={t} on={sel.kind === 'custom' && sel.id === t.id} onPress={() => setSel({ kind: 'custom', id: t.id })} onDelete={() => removeMaterial(t.id)} />
            ))}
          </ScrollView>
        </Box>
      </Col>
    </Box>
  );
}
