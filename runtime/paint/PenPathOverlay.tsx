import { useEffect, useRef, useState } from 'react';
import { Box, Graph, Pressable, Row, Text } from '../primitives';
import {
  normalizedPenPath,
  penHandleLinesD,
  penPathD,
  PEN_PATH_TUNING,
  type PenAnchor,
  type PenPoint,
} from './path';

type Gesture =
  | { kind: 'new-handle'; index: number }
  | { kind: 'anchor'; index: number; dx: number; dy: number }
  | { kind: 'in' | 'out'; index: number };

function distance(a: PenPoint, b: PenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mirrored(point: PenPoint, around: PenPoint): PenPoint {
  return { x: around.x * 2 - point.x, y: around.y * 2 - point.y };
}

/** Known-editor pen interaction shared by flat paint and the 3D mesh stage:
 * click adds a corner, click-drag gives it symmetric Bezier handles, clicking
 * the first anchor closes, and the separate Confirm button commits. The EDIT
 * mode chip locks out new anchors so grabbing a point can never misfire into
 * placing one; allowOpenConfirm lets edge-only consumers commit an unclosed
 * path (onConfirm's second argument reports which shape was committed). */
export function PenPathOverlay(props: {
  onConfirm: (normalizedPoints: Float32Array, closed: boolean) => void;
  onCancel: () => void;
  resetKey?: string | number;
  label?: string;
  accent?: string;
  allowOpenConfirm?: boolean;
}) {
  const accent = props.accent ?? '#58d8e8';
  const [anchors, setAnchors] = useState<PenAnchor[]>([]);
  const [closed, setClosed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rect, setRect] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const gestureRef = useRef<Gesture | null>(null);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;

  useEffect(() => {
    setAnchors([]);
    setClosed(false);
    setEditing(false);
    gestureRef.current = null;
  }, [props.resetKey]);

  const localPoint = (event: any): PenPoint => ({
    x: Math.max(0, Math.min(rect.width, Number(event?.x ?? 0) - rect.x)),
    y: Math.max(0, Math.min(rect.height, Number(event?.y ?? 0) - rect.y)),
  });
  const patchAnchor = (index: number, patch: (anchor: PenAnchor) => PenAnchor) => {
    setAnchors((current) => current.map((anchor, at) => at === index ? patch(anchor) : anchor));
  };
  const hit = (point: PenPoint) => {
    for (let index = anchorsRef.current.length - 1; index >= 0; index -= 1) {
      const anchor = anchorsRef.current[index]!;
      if (anchor.in && distance(anchor.in, point) <= PEN_PATH_TUNING.handleHitPx) return { kind: 'in' as const, index };
      if (anchor.out && distance(anchor.out, point) <= PEN_PATH_TUNING.handleHitPx) return { kind: 'out' as const, index };
      if (distance(anchor, point) <= PEN_PATH_TUNING.anchorHitPx) return { kind: 'anchor' as const, index };
    }
    return null;
  };

  const onDown = (event: any) => {
    const point = localPoint(event);
    const found = hit(point);
    if (found?.kind === 'anchor' && found.index === 0 && anchorsRef.current.length >= 3 && !closed && !editing) {
      setClosed(true);
      return;
    }
    if (found) {
      if (found.kind === 'anchor') {
        const anchor = anchorsRef.current[found.index]!;
        gestureRef.current = { kind: 'anchor', index: found.index, dx: point.x - anchor.x, dy: point.y - anchor.y };
      } else gestureRef.current = found;
      return;
    }
    // EDIT locks placement: an empty-space press that missed its grab does nothing
    // instead of quietly minting a stray anchor.
    if (editing || closed || anchorsRef.current.length >= PEN_PATH_TUNING.maxAnchors) return;
    const index = anchorsRef.current.length;
    setAnchors((current) => [...current, { x: point.x, y: point.y }]);
    gestureRef.current = { kind: 'new-handle', index };
  };
  const onMove = (event: any) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = localPoint(event);
    if (gesture.kind === 'anchor') {
      patchAnchor(gesture.index, (anchor) => {
        const next = { x: point.x - gesture.dx, y: point.y - gesture.dy };
        const dx = next.x - anchor.x;
        const dy = next.y - anchor.y;
        return {
          ...anchor,
          x: next.x,
          y: next.y,
          in: anchor.in ? { x: anchor.in.x + dx, y: anchor.in.y + dy } : undefined,
          out: anchor.out ? { x: anchor.out.x + dx, y: anchor.out.y + dy } : undefined,
        };
      });
      return;
    }
    patchAnchor(gesture.index, (anchor) => {
      if (gesture.kind === 'new-handle' || gesture.kind === 'out') return { ...anchor, out: point, in: mirrored(point, anchor) };
      return { ...anchor, in: point, out: mirrored(point, anchor) };
    });
  };
  const stopGesture = () => { gestureRef.current = null; };
  const undoPoint = () => {
    if (closed) { setClosed(false); return; }
    setAnchors((current) => current.slice(0, -1));
  };
  const canConfirmOpen = props.allowOpenConfirm === true && !closed && anchors.length >= 2;
  const confirm = () => {
    const current = anchorsRef.current;
    if (closed && current.length >= 3) {
      const polygon = normalizedPenPath(current, true, rect.width, rect.height);
      if (polygon.length >= 6) props.onConfirm(polygon, true);
      return;
    }
    if (props.allowOpenConfirm === true && !closed && current.length >= 2) {
      const line = normalizedPenPath(current, false, rect.width, rect.height);
      if (line.length >= 4) props.onConfirm(line, false);
    }
  };

  const handlesD = penHandleLinesD(anchors);
  return (
    <Box
      onLayout={(layout: any) => setRect({ x: layout.x, y: layout.y, width: Math.max(1, layout.width), height: Math.max(1, layout.height) })}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }}
    >
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={stopGesture}
        onMouseLeave={stopGesture}
        onKeyDown={(event: any) => {
          const key = String(event?.key ?? '').toLowerCase();
          if (key === 'escape') props.onCancel();
          else if (key === 'backspace' || key === 'delete') undoPoint();
          else if (key === 'enter') confirm();
          else if (key === 'tab' || key === 'e') setEditing((mode) => !mode);
        }}
        focusable
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      >
        <Graph style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none' }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          {handlesD ? <Graph.Path d={handlesD} fill="none" stroke="#8b97a8" strokeWidth={1} /> : null}
          {anchors.length > 0 ? <Graph.Path d={penPathD(anchors, closed)} fill={closed ? `${accent}28` : 'none'} stroke={accent} strokeWidth={2} /> : null}
        </Graph>
        {anchors.map((anchor, index) => (
          <Box key={`pen-anchor-${index}`} style={{ position: 'absolute', left: anchor.x - (index === 0 ? 5 : 4), top: anchor.y - (index === 0 ? 5 : 4), width: index === 0 ? 10 : 8, height: index === 0 ? 10 : 8, borderRadius: 2, backgroundColor: index === 0 ? '#f4d35e' : '#eef3fa', borderWidth: 1, borderColor: '#12151b', pointerEvents: 'none' }} />
        ))}
        {anchors.flatMap((anchor, index) => ([anchor.in, anchor.out].map((handle, side) => handle ? (
          <Box key={`pen-handle-${index}-${side}`} style={{ position: 'absolute', left: handle.x - 3, top: handle.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#12151b', borderWidth: 1, borderColor: '#aeb8c7', pointerEvents: 'none' }} />
        ) : null)))}
      </Pressable>
      <Row style={{ position: 'absolute', left: 12, bottom: 12, alignItems: 'center', gap: 6, padding: 6, borderRadius: 7, backgroundColor: 'rgba(12,15,21,0.94)', borderWidth: 1, borderColor: '#313a49' }}>
        <Text style={{ color: '#aeb8c7', fontSize: 9, marginLeft: 2 }}>{closed ? `${anchors.length} anchors · edit or confirm` : editing ? 'EDIT · drag anchors and handles · no new points' : props.label ?? 'Click corners · drag for curves · click gold anchor to close'}</Text>
        <Pressable onPress={() => setEditing((mode) => !mode)} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 4, backgroundColor: editing ? accent : '#202631' }}><Text style={{ color: editing ? '#081015' : '#d8dee9', fontSize: 9, fontWeight: '800' }}>{editing ? 'EDIT' : 'ADD'}</Text></Pressable>
        <Pressable onPress={undoPoint} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 4, backgroundColor: '#202631' }}><Text style={{ color: '#d8dee9', fontSize: 9, fontWeight: '800' }}>{closed ? 'REOPEN' : 'UNDO POINT'}</Text></Pressable>
        {!closed ? <Pressable onPress={() => { if (anchors.length >= 3) setClosed(true); }} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 4, backgroundColor: anchors.length >= 3 ? '#263546' : '#1a1e25' }}><Text style={{ color: anchors.length >= 3 ? '#d8dee9' : '#6f7784', fontSize: 9, fontWeight: '800' }}>CLOSE</Text></Pressable> : null}
        {closed || canConfirmOpen ? <Pressable onPress={confirm} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 4, backgroundColor: accent }}><Text style={{ color: '#081015', fontSize: 9, fontWeight: '900' }}>CONFIRM</Text></Pressable> : null}
        <Pressable onPress={props.onCancel} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 4, backgroundColor: '#2a2025' }}><Text style={{ color: '#efa9af', fontSize: 9, fontWeight: '800' }}>CANCEL</Text></Pressable>
      </Row>
    </Box>
  );
}
