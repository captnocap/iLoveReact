import { useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { solveCamera, CAMERAS, type Rect } from '@reactjit/cameras';

type BlockKind = 'grass' | 'dirt' | 'stone' | 'wood' | 'leaf' | 'sand' | 'brick' | 'glass' | 'water';
type Tool = 'build' | 'mine';

type Block = {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: BlockKind;
};

type Face = {
  key: string;
  label: string;
  dx: number;
  dy: number;
  dz: number;
};

type Vec3 = [number, number, number];
type Inventory = Record<BlockKind, number>;

const BLOCKS: Record<BlockKind, { label: string; color: string; opacity?: number; drop?: BlockKind; solid?: boolean }> = {
  grass: { label: 'Grass', color: '#48a23f', drop: 'dirt' },
  dirt: { label: 'Dirt', color: '#8a5a34' },
  stone: { label: 'Stone', color: '#80868a' },
  wood: { label: 'Wood', color: '#9a6a32' },
  leaf: { label: 'Leaf', color: '#39a85a', opacity: 0.82 },
  sand: { label: 'Sand', color: '#d9c175' },
  brick: { label: 'Brick', color: '#b54d3f' },
  glass: { label: 'Glass', color: '#8fe6ff', opacity: 0.42 },
  water: { label: 'Water', color: '#3b8ef3', opacity: 0.48, solid: false },
};

const HOTBAR: BlockKind[] = ['dirt', 'stone', 'wood', 'leaf', 'sand', 'brick', 'glass'];
const FACES: Face[] = [
  { key: 'xp', label: '+X', dx: 1, dy: 0, dz: 0 },
  { key: 'xn', label: '-X', dx: -1, dy: 0, dz: 0 },
  { key: 'yp', label: '+Y', dx: 0, dy: 1, dz: 0 },
  { key: 'yn', label: '-Y', dx: 0, dy: -1, dz: 0 },
  { key: 'zp', label: '+Z', dx: 0, dy: 0, dz: 1 },
  { key: 'zn', label: '-Z', dx: 0, dy: 0, dz: -1 },
];

const START_INVENTORY: Inventory = {
  grass: 0,
  dirt: 18,
  stone: 14,
  wood: 10,
  leaf: 12,
  sand: 8,
  brick: 12,
  glass: 8,
  water: 0,
};

const coordKey = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
const add = (a: Block, f: Face) => ({ x: a.x + f.dx, y: a.y + f.dy, z: a.z + f.dz });
const faceByDelta = (dx: number, dy: number, dz: number): Face =>
  FACES.find((f) => f.dx === dx && f.dy === dy && f.dz === dz) ?? FACES[2];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hexRgb(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function heightAt(x: number, z: number): number {
  const wave = Math.sin(x * 0.78) * 0.75 + Math.cos(z * 0.62) * 0.65 + Math.sin((x + z) * 0.35) * 0.45;
  return Math.round(wave);
}

function makeWorld(): Block[] {
  const blocks: Block[] = [];
  let id = 1;
  const occupied = new Set<string>();
  const put = (x: number, y: number, z: number, kind: BlockKind) => {
    const key = coordKey(x, y, z);
    if (occupied.has(key)) return;
    occupied.add(key);
    blocks.push({ id: id++, x, y, z, kind });
  };

  for (let x = -6; x <= 6; x++) {
    for (let z = -6; z <= 6; z++) {
      const h = heightAt(x, z);
      put(x, -2, z, 'stone');
      put(x, -1, z, h <= -1 ? 'stone' : 'dirt');
      if (h >= 0) put(x, 0, z, h === 0 ? 'grass' : 'dirt');
      if (h >= 1) put(x, 1, z, 'grass');
      if (h < 0 && x > -2 && x < 3 && z > -5 && z < -1) put(x, 0, z, 'water');
    }
  }

  const tree = (x: number, z: number) => {
    const y0 = heightAt(x, z) + 1;
    put(x, y0, z, 'wood');
    put(x, y0 + 1, z, 'wood');
    put(x, y0 + 2, z, 'wood');
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) <= 2) put(x + dx, y0 + 3, z + dz, 'leaf');
      }
    }
    put(x, y0 + 4, z, 'leaf');
  };
  tree(-4, 3);
  tree(4, 2);
  tree(-2, -5);

  return blocks;
}

function centerOf(blocks: Block[]): Vec3 {
  if (blocks.length === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const b of blocks) {
    sx += b.x;
    sy += b.y;
    sz += b.z;
  }
  return [sx / blocks.length, sy / blocks.length, sz / blocks.length];
}

function screenRay(sx: number, sy: number, rect: Rect, cam: { pos: Vec3; target: Vec3; fov: number }): { o: Vec3; d: Vec3 } {
  const { pos, target, fov } = cam;
  let fx = pos[0] - target[0], fy = pos[1] - target[1], fz = pos[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let sxv = fz, syv = 0, szv = -fx;
  const sl = Math.hypot(sxv, syv, szv) || 1; sxv /= sl; syv /= sl; szv /= sl;
  const ux = fy * szv - fz * syv;
  const uy = fz * sxv - fx * szv;
  const uz = fx * syv - fy * sxv;
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const tanHalf = Math.tan((fov * Math.PI) / 180 / 2);
  const ndcX = (sx / w) * 2 - 1, ndcY = 1 - (sy / h) * 2;
  const vx = ndcX * tanHalf * (w / h), vy = ndcY * tanHalf, vz = -1;
  let dx = vx * sxv + vy * ux + vz * fx;
  let dy = vx * syv + vy * uy + vz * fy;
  let dz = vx * szv + vy * uz + vz * fz;
  const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  return { o: pos, d: [dx, dy, dz] };
}

function rayBlockFace(o: Vec3, d: Vec3, block: Block): { t: number; face: Face } | null {
  const c: Vec3 = [block.x, block.y, block.z];
  let tmin = -Infinity;
  let tmax = Infinity;
  let enter: Face = FACES[2];
  let exit: Face = FACES[3];

  for (let a = 0; a < 3; a++) {
    const lo = c[a] - 0.5;
    const hi = c[a] + 0.5;
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo || o[a] > hi) return null;
      continue;
    }

    const axisFace = (sign: number): Face => {
      if (a === 0) return faceByDelta(sign, 0, 0);
      if (a === 1) return faceByDelta(0, sign, 0);
      return faceByDelta(0, 0, sign);
    };
    const near = d[a] > 0
      ? { t: (lo - o[a]) / d[a], face: axisFace(-1) }
      : { t: (hi - o[a]) / d[a], face: axisFace(1) };
    const far = d[a] > 0
      ? { t: (hi - o[a]) / d[a], face: axisFace(1) }
      : { t: (lo - o[a]) / d[a], face: axisFace(-1) };

    if (near.t > tmin) { tmin = near.t; enter = near.face; }
    if (far.t < tmax) { tmax = far.t; exit = far.face; }
    if (tmin > tmax) return null;
  }

  if (tmax < 0) return null;
  return tmin > 0 ? { t: tmin, face: enter } : { t: tmax, face: exit };
}

function pickBlockFace(sx: number, sy: number, rect: Rect, cam: { pos: Vec3; target: Vec3; fov: number }, blocks: Block[]): { block: Block; face: Face } | null {
  const { o, d } = screenRay(sx, sy, rect, cam);
  let best: { block: Block; face: Face; t: number } | null = null;
  for (const block of blocks) {
    const hit = rayBlockFace(o, d, block);
    if (hit && hit.t > 0 && (!best || hit.t < best.t)) best = { block, face: hit.face, t: hit.t };
  }
  return best ? { block: best.block, face: best.face } : null;
}

function Button(props: { label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.disabled ? undefined : props.onPress}>
      <Box style={{
        minWidth: 58,
        height: 34,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: props.disabled ? '#242426' : (props.active ? '#e7ece8' : '#181a1d'),
        borderWidth: 1,
        borderColor: props.disabled ? '#333337' : (props.active ? '#f8f7f2' : '#36393d'),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Text style={{
          fontSize: 13,
          color: props.disabled ? '#6a6c70' : (props.active ? '#111315' : '#e8ece9'),
          fontWeight: props.active ? 'bold' : 'normal',
        }}>{props.label}</Text>
      </Box>
    </Pressable>
  );
}

function HotbarSlot(props: { kind: BlockKind; active: boolean; count: number; onPress: () => void }) {
  const def = BLOCKS[props.kind];
  return (
    <Pressable onPress={props.onPress}>
      <Col style={{
        width: 58,
        height: 58,
        gap: 3,
        borderRadius: 7,
        backgroundColor: props.active ? '#e7ece8' : '#151719',
        borderWidth: 1,
        borderColor: props.active ? '#f8f7f2' : '#2b2e31',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Box style={{ width: 24, height: 24, borderRadius: 4, backgroundColor: def.color, opacity: def.opacity ?? 1 }} />
        <Text style={{ fontSize: 10, color: props.active ? '#111315' : '#dce2de' }}>{props.count}</Text>
      </Col>
    </Pressable>
  );
}

function BlockButton(props: { block: Block; active: boolean; onPress: () => void }) {
  const b = props.block;
  const def = BLOCKS[b.kind];
  return (
    <Pressable onPress={props.onPress}>
      <Row style={{
        height: 34,
        gap: 8,
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: props.active ? '#2d312f' : '#151719',
        borderWidth: 1,
        borderColor: props.active ? '#e7ece8' : '#2b2e31',
      }}>
        <Box style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: def.color, opacity: def.opacity ?? 1 }} />
        <Text style={{ fontSize: 12, color: '#dce2de' }}>#{b.id}</Text>
        <Text style={{ fontSize: 12, color: '#8e9691' }}>{def.label}</Text>
      </Row>
    </Pressable>
  );
}

function FaceHandle(props: { selected: Block; face: Face; active: boolean; color: string; tool: Tool }) {
  const f = props.face;
  const pos: Vec3 = [
    props.selected.x + f.dx * 0.56,
    props.selected.y + f.dy * 0.56,
    props.selected.z + f.dz * 0.56,
  ];
  const params = {
    width: f.dx !== 0 ? 0.08 : 0.44,
    height: f.dy !== 0 ? 0.08 : 0.44,
    depth: f.dz !== 0 ? 0.08 : 0.44,
  };
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={params}
      material={{ color: props.active ? (props.tool === 'mine' ? '#ff355e' : props.color) : '#f8f7f2', opacity: props.active ? 0.68 : 0.18 }}
      position={pos}
    />
  );
}

function VoxelScene(props: {
  blocks: Block[];
  selected: Block;
  activeKind: BlockKind;
  activeFace: Face;
  tool: Tool;
  onFaceClick: (block: Block, face: Face) => void;
  onMiss: () => void;
}) {
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(31);
  const [dist, setDist] = useState(15);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1000, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  const center = centerOf(props.blocks);
  const target: Vec3 = [center[0], clamp(center[1] + 0.6, 0, 2.2), center[2]];
  const solved = useMemo(
    () => solveCamera(CAMERAS.Orbit, { target, yaw, pitch, dist, zoom: 1, fov: 48 }),
    [target[0], target[1], target[2], yaw, pitch, dist],
  );
  const occupied = new Set(props.blocks.map((b) => coordKey(b.x, b.y, b.z)));
  const previewPos = add(props.selected, props.activeFace);
  const previewFilled = occupied.has(coordKey(previewPos.x, previewPos.y, previewPos.z));
  const minY = Math.min(...props.blocks.map((b) => b.y), previewPos.y);
  const activeDef = BLOCKS[props.activeKind];
  const instanceBatches = useMemo(() => {
    return HOTBAR.concat(['grass', 'water'] as BlockKind[]).map((kind) => {
      const def = BLOCKS[kind];
      const [r, g, b] = hexRgb(def.color);
      const data: number[] = [];
      for (const block of props.blocks) {
        if (block.kind !== kind) continue;
        data.push(block.x, block.y, block.z, 1, 1, 1, r, g, b);
      }
      return { kind, data, count: data.length / 9 };
    }).filter((batch) => batch.count > 0);
  }, [props.blocks]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy);
    d.x = nx;
    d.y = ny;
    setYaw((v) => v + dx * 0.4);
    setPitch((v) => clamp(v - dy * 0.3, 7, 84));
  };
  const onUp = (e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.dist >= 6) return;
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x;
    const sy = Number(e?.y ?? 0) - r.y;
    const hit = pickBlockFace(sx, sy, r, solved as any, props.blocks);
    if (hit) props.onFaceClick(hit.block, hit.face);
    else props.onMiss();
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    setDist((v) => clamp(v + (dy > 0 ? 1 : -1) * 1.1, 8, 28));
  };

  return (
    <Pressable
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onWheel={onWheel}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#101813" showGrid={false} showAxes={false}>
        <Scene3D.Camera position={solved.pos} target={solved.target} fov={solved.fov} far={90} />
        <Scene3D.Skybox
          zenith="#3570a7"
          horizon="#c8d7bc"
          ground="#172015"
          sunDir={[0.5, 0.78, 0.3]}
          sunColor="#fff1bd"
          sunSize={0.018}
          sunGlow={0.3}
          haze={0.22}
          cloud={0.24}
          night={0}
        />
        <Scene3D.Fog near={42} far={78} color="#c8d7bc" />
        <Scene3D.AmbientLight color="#dce6dc" intensity={0.5} />
        <Scene3D.DirectionalLight direction={[0.45, 0.9, 0.36]} color="#ffe3a8" intensity={0.9} />
        <Scene3D.PointLight position={[-4, 7, 6]} color="#58d6ff" intensity={0.18} />

        <Scene3D.Mesh
          geometry={Geometry.Box}
          params={{ width: 24, height: 0.08, depth: 24 }}
          material="#222a22"
          position={[0, minY - 0.56, 0]}
        />

        {instanceBatches.map((batch) => (
          <Scene3D.Instances
            key={batch.kind}
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            data={batch.data}
            count={batch.count}
            stride={9}
            center={[0, 0, 0]}
            boundsRadius={40}
          />
        ))}

        <Scene3D.Mesh
          geometry={Geometry.Box}
          params={{ width: 1.08, height: 1.08, depth: 1.08 }}
          material={{ color: props.tool === 'mine' ? '#ff355e' : '#f8f7f2', opacity: 0.18 }}
          position={[props.selected.x, props.selected.y, props.selected.z]}
        />

        {FACES.map((face) => (
          <FaceHandle
            key={face.key}
            selected={props.selected}
            face={face}
            active={face.key === props.activeFace.key}
            color={activeDef.color}
            tool={props.tool}
          />
        ))}

        {props.tool === 'build' ? (
          <Scene3D.Mesh
            geometry={Geometry.Box}
            params={{ width: 0.96, height: 0.96, depth: 0.96 }}
            material={{ color: previewFilled ? '#ff355e' : activeDef.color, opacity: previewFilled ? 0.24 : 0.38 }}
            position={[previewPos.x, previewPos.y, previewPos.z]}
          />
        ) : null}
      </Scene3D>
    </Pressable>
  );
}

export default function VoxelStackDemo() {
  const [blocks, setBlocks] = useState<Block[]>(() => makeWorld());
  const [selectedId, setSelectedId] = useState(1);
  const [activeKind, setActiveKind] = useState<BlockKind>('wood');
  const [activeFace, setActiveFace] = useState(FACES[2]);
  const [tool, setTool] = useState<Tool>('build');
  const [inventory, setInventory] = useState<Inventory>(START_INVENTORY);
  const [status, setStatus] = useState('Ready');

  const selected = useMemo(() => blocks.find((b) => b.id === selectedId) ?? blocks[0], [blocks, selectedId]);
  const occupied = useMemo(() => new Set(blocks.map((b) => coordKey(b.x, b.y, b.z))), [blocks]);
  const preview = selected ? add(selected, activeFace) : { x: 0, y: 0, z: 0 };
  const previewOccupied = occupied.has(coordKey(preview.x, preview.y, preview.z));
  const tallest = blocks.reduce((m, b) => Math.max(m, b.y), -2);

  function placeOnFace(block: Block, face: Face) {
    setActiveFace(face);
    setSelectedId(block.id);

    if (tool === 'mine') {
      if (block.y <= -2 || block.kind === 'water') {
        setStatus('Locked');
        return;
      }
      const drop = BLOCKS[block.kind].drop ?? block.kind;
      const remaining = blocks.filter((b) => b.id !== block.id);
      setBlocks(remaining);
      setInventory((old) => ({ ...old, [drop]: (old[drop] ?? 0) + 1 }));
      setSelectedId(remaining[remaining.length - 1]?.id ?? 1);
      setStatus(`Mined ${BLOCKS[block.kind].label}`);
      return;
    }

    const nextPos = add(block, face);
    const key = coordKey(nextPos.x, nextPos.y, nextPos.z);
    const hit = blocks.find((b) => coordKey(b.x, b.y, b.z) === key);
    if (hit) {
      setSelectedId(hit.id);
      setStatus('Occupied');
      return;
    }
    if ((inventory[activeKind] ?? 0) <= 0) {
      setStatus(`No ${BLOCKS[activeKind].label}`);
      return;
    }
    const nextId = blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    setBlocks((old) => [...old, { id: nextId, ...nextPos, kind: activeKind }]);
    setInventory((old) => ({ ...old, [activeKind]: Math.max(0, (old[activeKind] ?? 0) - 1) }));
    setSelectedId(nextId);
    setStatus(`Placed ${BLOCKS[activeKind].label}`);
  }

  function reset() {
    setBlocks(makeWorld());
    setSelectedId(1);
    setActiveFace(FACES[2]);
    setActiveKind('wood');
    setTool('build');
    setInventory(START_INVENTORY);
    setStatus('Ready');
  }

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d0c' }}>
      {selected ? (
        <VoxelScene
          blocks={blocks}
          selected={selected}
          activeKind={activeKind}
          activeFace={activeFace}
          tool={tool}
          onFaceClick={placeOnFace}
          onMiss={() => setStatus('Miss')}
        />
      ) : null}

      <Col style={{
        position: 'absolute',
        left: 18,
        top: 18,
        width: 304,
        gap: 12,
        padding: 14,
        borderRadius: 8,
        backgroundColor: '#0f1110e6',
        borderWidth: 1,
        borderColor: '#2a2d29',
      }}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 21, color: '#f8f7f2', fontWeight: 'bold' }}>Blockcraft</Text>
          <Text style={{ fontSize: 12, color: previewOccupied ? '#ff8aa3' : '#9aa59d' }}>{status}</Text>
        </Row>

        <Row style={{ gap: 8 }}>
          <Button label="Build" active={tool === 'build'} onPress={() => setTool('build')} />
          <Button label="Mine" active={tool === 'mine'} onPress={() => setTool('mine')} />
          <Button label="Reset" onPress={reset} />
        </Row>

        <Col style={{ gap: 8 }}>
          <Text style={{ fontSize: 11, color: '#88918a', fontWeight: 'bold' }}>HOTBAR</Text>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            {HOTBAR.map((kind) => (
              <HotbarSlot
                key={kind}
                kind={kind}
                active={activeKind === kind}
                count={inventory[kind] ?? 0}
                onPress={() => { setActiveKind(kind); setTool('build'); }}
              />
            ))}
          </Row>
        </Col>

        <Row style={{ gap: 12 }}>
          <Col style={{ gap: 3 }}>
            <Text style={{ fontSize: 10, color: '#88918a' }}>BLOCKS</Text>
            <Text style={{ fontSize: 17, color: '#f8f7f2', fontWeight: 'bold' }}>{blocks.length}</Text>
          </Col>
          <Col style={{ gap: 3 }}>
            <Text style={{ fontSize: 10, color: '#88918a' }}>HEIGHT</Text>
            <Text style={{ fontSize: 17, color: tallest >= 8 ? '#86efac' : '#f8f7f2', fontWeight: 'bold' }}>{tallest}</Text>
          </Col>
          <Col style={{ gap: 3 }}>
            <Text style={{ fontSize: 10, color: '#88918a' }}>TOOL</Text>
            <Text style={{ fontSize: 17, color: tool === 'mine' ? '#ff8aa3' : '#f8f7f2', fontWeight: 'bold' }}>{tool}</Text>
          </Col>
        </Row>
      </Col>

      <Col style={{
        position: 'absolute',
        right: 18,
        top: 18,
        width: 230,
        maxHeight: 560,
        gap: 8,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#0f1110e6',
        borderWidth: 1,
        borderColor: '#2a2d29',
      }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, color: '#f8f7f2', fontWeight: 'bold' }}>Recent</Text>
          <Text style={{ fontSize: 12, color: '#9aa59d' }}>{blocks.length}</Text>
        </Row>
        <Col style={{ gap: 6 }}>
          {blocks.slice().reverse().slice(0, 12).map((block) => (
            <BlockButton key={block.id} block={block} active={block.id === selectedId} onPress={() => {
              setSelectedId(block.id);
              setStatus(`Selected #${block.id}`);
            }} />
          ))}
        </Col>
      </Col>

      {selected ? (
        <Row style={{
          position: 'absolute',
          left: 18,
          bottom: 18,
          gap: 10,
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          height: 38,
          borderRadius: 8,
          backgroundColor: '#0f1110d9',
          borderWidth: 1,
          borderColor: '#2a2d29',
        }}>
          <Text style={{ fontSize: 12, color: '#88918a' }}>selected</Text>
          <Text style={{ fontSize: 13, color: '#f8f7f2', fontWeight: 'bold' }}>#{selected.id}</Text>
          <Box style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: BLOCKS[selected.kind].color, opacity: BLOCKS[selected.kind].opacity ?? 1 }} />
          <Text style={{ fontSize: 12, color: '#aeb8b0' }}>{BLOCKS[selected.kind].label}</Text>
          <Text style={{ fontSize: 12, color: '#aeb8b0' }}>{selected.x}, {selected.y}, {selected.z}</Text>
          <Text style={{ fontSize: 12, color: previewOccupied ? '#ff8aa3' : '#9aa59d' }}>{activeFace.label} {'>'} {preview.x}, {preview.y}, {preview.z}</Text>
        </Row>
      ) : null}
    </Box>
  );
}
