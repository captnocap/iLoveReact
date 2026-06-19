// editors/paint/LayerStrip.tsx — the one paint-layer control surface.
//
// PAINTLAYERS-0606: every host surface that shows a paint stack mounts this
// component. Row order is visual top-to-bottom; data remains bottom-up.

import { useState } from 'react';
import { Box, Col, Image, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_CHROME } from '../../game/chrome';
import {
  controlsForPaintLayer, paintLayerActionEnabled, paintLayerDisplayOrder, runPaintLayerAction,
  type PaintLayerControl,
} from './layers';
import { isBuiltinSurface, maskSurfaceLabel } from './surfaces';
import type { PaintEditorState } from './usePaintEditor';
import { PaintQuad } from './PaintSurface';

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

const PREVIEW = Object.freeze({ w: 34, h: 24 });

export type LayerStripAction = 'visibility' | 'duplicate' | 'move-up' | 'move-down' | 'merge-down' | 'delete';
export type LayerStripRowModel = {
  id: string;
  name: string;
  meta: string;
  active: boolean;
  muted?: boolean;
  groupName?: string | null;
  preview: any;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** when set, the row shows a merge verb that folds it into the layer above it. */
  canMerge?: boolean;
};

export function LayerStackStrip(props: {
  title?: string;
  rows: LayerStripRowModel[];
  height?: number | string;
  maxHeight?: number;
  emptyText?: string;
  onAdd?(): void;
  onPaste?(): void;
  onSelect(id: string): void;
  onRename(id: string, name: string): void;
  onAction(id: string, action: LayerStripAction): void;
}) {
  const bodyStyle = props.height
    ? { flexGrow: 1, flexBasis: 0, minHeight: 0 }
    : { maxHeight: props.maxHeight ?? 220 };
  return (
    <Col style={{ height: props.height, minHeight: 0, gap: 6, backgroundColor: props.height ? T.page : undefined }}>
      <Row style={{ gap: 6, alignItems: 'center', paddingHorizontal: props.height ? 10 : 0, paddingTop: props.height ? 6 : 0 }}>
        <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1, flexGrow: 1 }}>
          {`${props.title ?? 'LAYERS'}${props.rows.length ? ` (${props.rows.length})` : ''}`}
        </Text>
        {props.onAdd ? <Chip label="+ add" color="good" onPress={props.onAdd} /> : null}
        {props.onPaste ? <Chip label="paste" color="dim" onPress={props.onPaste} /> : null}
      </Row>
      <ScrollView style={bodyStyle}>
        <Col style={{ paddingHorizontal: props.height ? 10 : 0, paddingBottom: props.height ? 8 : 0, gap: 5 }}>
          {props.rows.length === 0 ? (
            <Text style={{ color: T.dim, fontSize: 10 }}>{props.emptyText ?? 'No layers.'}</Text>
          ) : null}
          {props.rows.map((row) => (
            <GenericLayerRow key={row.id} row={row} onSelect={props.onSelect} onRename={props.onRename} onAction={props.onAction} />
          ))}
        </Col>
      </ScrollView>
    </Col>
  );
}

function GenericLayerRow(props: {
  row: LayerStripRowModel;
  onSelect(id: string): void;
  onRename(id: string, name: string): void;
  onAction(id: string, action: LayerStripAction): void;
}) {
  const { row } = props;
  const [renaming, setRenaming] = useState(false);
  return (
    <Pressable onPress={() => props.onSelect(row.id)}>
      <Row style={{
        gap: 7, alignItems: 'center', padding: 6, borderRadius: 5,
        backgroundColor: row.active ? T.controlAlt : T.control,
        borderWidth: 1, borderColor: row.active ? T.accent : T.frame,
        opacity: row.muted ? 0.55 : 1,
      }}>
        <Box style={{ width: 3, height: 38, borderRadius: 2, backgroundColor: row.active ? T.accent : T.frame }} />
        <Box style={{
          width: PREVIEW.w, height: PREVIEW.h,
          borderRadius: 4, overflow: 'hidden', position: 'relative',
          backgroundColor: T.page, borderWidth: 1, borderColor: T.frame,
        }}>
          {row.preview}
        </Box>
        {/* req_1389: the NAME owns its own line (full dock width) and the management
            verbs drop to the meta line below, so a layer's name is always readable —
            the old single-row layout buried it behind six inline buttons. Only the
            visibility toggle stays on the name line; it earns the pixels. */}
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 3 }}>
          {renaming ? (
            <TextInput
              value={row.name}
              onChangeText={(v: string) => props.onRename(row.id, v)}
              onSubmit={() => setRenaming(false)}
              onSubmitEditing={() => setRenaming(false)}
              style={{
                height: 18, fontSize: 11, color: T.ink, backgroundColor: T.page,
                borderWidth: 1, borderColor: T.accent, borderRadius: 3, paddingHorizontal: 4,
              }}
            />
          ) : (
            <Row style={{ gap: 5, alignItems: 'center' }}>
              <Text style={{ color: row.active ? T.ink : T.dim, fontSize: 11, fontWeight: '700', flexGrow: 1, flexBasis: 0, minWidth: 0 }} numberOfLines={1}>
                {row.name}
              </Text>
              <Pressable onPress={() => setRenaming(true)} tooltip="Rename layer">
                <Icon name="Pencil" size={10} color={T.dim} />
              </Pressable>
              <LayerButton icon={row.muted ? 'EyeOff' : 'Eye'} label={row.muted ? 'Show layer' : 'Hide layer'} onPress={() => props.onAction(row.id, 'visibility')} />
            </Row>
          )}
          <Row style={{ gap: 5, alignItems: 'center' }}>
            <Text style={{ color: T.dim, fontSize: 9 }} numberOfLines={1}>{row.meta}</Text>
            {row.groupName ? (
              <Box style={{ paddingHorizontal: 4, borderRadius: 3, borderWidth: 1, borderColor: T.frame }}>
                <Text style={{ color: T.dim, fontSize: 8, fontWeight: '800' }} numberOfLines={1}>{row.groupName}</Text>
              </Box>
            ) : null}
            <Box style={{ flexGrow: 1 }} />
            <LayerButton icon="Copy" label="Duplicate layer" onPress={() => props.onAction(row.id, 'duplicate')} />
            <LayerButton icon="ArrowUp" label="Move layer up" disabled={!row.canMoveUp} onPress={() => props.onAction(row.id, 'move-up')} />
            <LayerButton icon="ArrowDown" label="Move layer down" disabled={!row.canMoveDown} onPress={() => props.onAction(row.id, 'move-down')} />
            {row.canMerge !== undefined ? (
              <LayerButton icon="Merge" label="Merge into the layer above — fuse this layer down into the one above it" disabled={!row.canMerge} onPress={() => props.onAction(row.id, 'merge-down')} />
            ) : null}
            <LayerButton icon="Trash2" label="Delete layer" danger onPress={() => props.onAction(row.id, 'delete')} />
          </Row>
        </Col>
      </Row>
    </Pressable>
  );
}

export function PaintLayerStrip(props: { s: PaintEditorState; height?: number; maxHeight?: number }) {
  const { s } = props;
  const bodyStyle = props.height
    ? { flexGrow: 1, flexBasis: 0, minHeight: 0 }
    : { maxHeight: props.maxHeight ?? 220 };
  return (
    <Col style={{ height: props.height, minHeight: 0, gap: 6, backgroundColor: props.height ? T.page : undefined }}>
      <Row style={{ gap: 6, alignItems: 'center', paddingHorizontal: props.height ? 10 : 0, paddingTop: props.height ? 6 : 0 }}>
        <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1, flexGrow: 1 }}>
          {`LAYERS${s.layers.length ? ` (${s.layers.length})` : ''}`}
        </Text>
        <Chip label="+ add" color="good" onPress={() => s.addLayer()} />
        {s.clipboard ? <Chip label="paste" color="dim" onPress={s.pasteLayer} /> : null}
      </Row>
      <ScrollView style={bodyStyle}>
        <Col style={{ paddingHorizontal: props.height ? 10 : 0, paddingBottom: props.height ? 8 : 0, gap: 5 }}>
          {s.layers.length === 0 ? (
            <Text style={{ color: T.dim, fontSize: 10 }}>No layers — paint or smart-select a region.</Text>
          ) : null}
          {paintLayerDisplayOrder(s).map((index) => (
            <LayerRow key={s.layers[index].id} s={s} index={index} />
          ))}
        </Col>
      </ScrollView>
    </Col>
  );
}

function LayerRow({ s, index }: { s: PaintEditorState; index: number }) {
  const layer = s.layers[index];
  const active = index === s.activeLayer;
  const [renaming, setRenaming] = useState(false);
  const controls = controlsForPaintLayer(layer);
  const has = (id: PaintLayerControl) => controls.includes(id);
  const surfaceLabel = layer.image ? 'Image' : isBuiltinSurface(layer.config.mode)
    ? maskSurfaceLabel(layer.config.mode)
    : (s.customSurfaces.find((c) => c.id === layer.config.mode)?.label ?? 'Custom FX');
  return (
    <Pressable onPress={() => runPaintLayerAction(s, index, 'select')}>
      <Row style={{
        gap: 7, alignItems: 'center', padding: 6, borderRadius: 5,
        backgroundColor: active ? T.controlAlt : T.control,
        borderWidth: 1, borderColor: active ? T.accent : T.frame,
        opacity: layer.config.muted ? 0.55 : 1,
      }}>
        <Box style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: active ? T.accent : T.frame }} />
        <LayerPreview s={s} index={index} />
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 1 }}>
          {renaming ? (
            <TextInput
              value={layer.name}
              onChangeText={(v: string) => s.setLayerName(index, v)}
              onSubmit={() => setRenaming(false)}
              onSubmitEditing={() => setRenaming(false)}
              style={{
                height: 18, fontSize: 11, color: T.ink, backgroundColor: T.page,
                borderWidth: 1, borderColor: T.accent, borderRadius: 3, paddingHorizontal: 4,
              }}
            />
          ) : (
            <Row style={{ gap: 5, alignItems: 'center' }}>
              <Text style={{ color: active ? T.ink : T.dim, fontSize: 11, fontWeight: '700', flexGrow: 1 }} numberOfLines={1}>
                {layer.name}
              </Text>
              <Pressable onPress={() => setRenaming(true)} tooltip="Rename layer">
                <Icon name="Pencil" size={10} color={T.dim} />
              </Pressable>
            </Row>
          )}
          <Row style={{ gap: 5, alignItems: 'center' }}>
            <Text style={{ color: T.dim, fontSize: 9 }} numberOfLines={1}>{surfaceLabel}</Text>
            {layer.groupName ? (
              <Box style={{ paddingHorizontal: 4, borderRadius: 3, borderWidth: 1, borderColor: T.frame }}>
                <Text style={{ color: T.dim, fontSize: 8, fontWeight: '800' }} numberOfLines={1}>{layer.groupName}</Text>
              </Box>
            ) : null}
            {layer.clicks.length > 0 ? <Text style={{ color: T.dim, fontSize: 8 }}>{`${layer.clicks.length}c`}</Text> : null}
          </Row>
        </Col>
        {has('visibility') ? (
          <LayerButton
            icon={layer.config.muted ? 'EyeOff' : 'Eye'}
            label={layer.config.muted ? 'Show layer' : 'Hide layer'}
            onPress={() => runPaintLayerAction(s, index, 'visibility')}
          />
        ) : null}
        {has('duplicate') ? <LayerButton icon="Copy" label="Duplicate layer" onPress={() => runPaintLayerAction(s, index, 'duplicate')} /> : null}
        {has('move-up') ? <LayerButton icon="ArrowUp" label="Move layer up" disabled={!paintLayerActionEnabled(s, index, 'move-up')} onPress={() => runPaintLayerAction(s, index, 'move-up', layer.id)} /> : null}
        {has('move-down') ? <LayerButton icon="ArrowDown" label="Move layer down" disabled={!paintLayerActionEnabled(s, index, 'move-down')} onPress={() => runPaintLayerAction(s, index, 'move-down', layer.id)} /> : null}
        {has('merge-down') ? <LayerButton icon="Merge" label="Merge down" disabled={!paintLayerActionEnabled(s, index, 'merge-down')} onPress={() => runPaintLayerAction(s, index, 'merge-down')} /> : null}
        {has('cut') ? <LayerButton icon="Scissors" label="Cut layer to clipboard" onPress={() => runPaintLayerAction(s, index, 'cut')} /> : null}
        {has('delete') ? <LayerButton icon="Trash2" label="Delete layer" danger onPress={() => runPaintLayerAction(s, index, 'delete')} /> : null}
      </Row>
    </Pressable>
  );
}

function LayerPreview({ s, index }: { s: PaintEditorState; index: number }) {
  const layer = s.layers[index];
  return (
    <Box style={{
      width: PREVIEW.w, height: PREVIEW.h,
      borderRadius: 4, overflow: 'hidden', position: 'relative',
      backgroundColor: T.page, borderWidth: 1, borderColor: T.frame,
    }}>
      {layer.image ? (
        <Image source={layer.image.path} style={{ width: PREVIEW.w, height: PREVIEW.h }} />
      ) : (
        <PaintQuad
          paintableId={s.baseIdOf(layer)}
          overrideId={s.brushIdOf(layer)}
          worldW={PREVIEW.w}
          worldH={PREVIEW.h}
          mode={layer.config.mode}
          customSurfaces={s.customSurfaces}
          colors={layer.config.colors}
          dim={1}
        />
      )}
    </Box>
  );
}

function LayerButton(props: { icon: string; label: string; disabled?: boolean; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={() => { if (!props.disabled) props.onPress(); }} tooltip={props.label}>
      <Box style={{
        width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
        backgroundColor: props.danger ? '#301822' : T.controlAlt,
        borderWidth: 1, borderColor: T.frame,
        opacity: props.disabled ? 0.35 : 1,
      }}>
        <Icon name={props.icon} size={11} color={props.danger ? T.bad : T.dim} />
      </Box>
    </Pressable>
  );
}
