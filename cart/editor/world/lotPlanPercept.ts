// lotPlanPercept.ts — the lot plan rendered for eyes that read text (req_4514).
//
// The percept is the feedback half of the loop: an agent authors plan data,
// then reads this back — an ASCII floor plan plus measured facts and the full
// audit — exactly the way `tools/seat look` answers for a mesh. Everything
// here derives from the plan and the measured catalog; nothing is stored.

import {
  auditLotPlan,
  fmtMeters,
  lotEdgeKey,
  lotPlacementRect,
  type LotFinding,
  type LotPlaceableFacts,
  type LotPlan,
} from './lotPlan';

export type LotPlanSummary = {
  name: string;
  widthU: number;
  heightU: number;
  rooms: { id: string; name: string; glyph: string; areaU2: number }[];
  walls: number;
  openings: { edge: string; kind: string; kitId: string | null }[];
  placements: {
    id: string;
    glyph: string;
    placeableId: string;
    name: string | null;
    /** Continuous meters — fractional is the norm (req_4562). */
    at: { xU: number; yU: number };
    rotation: number;
    /** MEASURED meters after rotation, never rounded. */
    footprintU: { widthU: number; depthU: number } | null;
  }[];
  findings: LotFinding[];
};

const ROOM_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PLACEMENT_GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789';

const roomGlyph = (index: number): string => ROOM_GLYPHS[index % ROOM_GLYPHS.length]!;
const placementGlyph = (index: number): string => PLACEMENT_GLYPHS[index % PLACEMENT_GLYPHS.length]!;

export function summarizeLotPlan(plan: LotPlan, catalog: Map<string, LotPlaceableFacts>): LotPlanSummary {
  const areas = new Map<number, number>();
  plan.cells.forEach((room) => {
    if (room >= 0) areas.set(room, (areas.get(room) ?? 0) + 1);
  });
  return {
    name: plan.name,
    widthU: plan.widthU,
    heightU: plan.heightU,
    rooms: plan.rooms.map((room, index) => ({
      id: room.id,
      name: room.name,
      glyph: roomGlyph(index),
      areaU2: areas.get(index) ?? 0,
    })),
    walls: plan.walls.length,
    openings: plan.openings.map((opening) => ({
      edge: lotEdgeKey(opening.edge),
      kind: opening.kind,
      kitId: opening.kitId,
    })),
    placements: plan.placements.map((placement, index) => {
      const facts = catalog.get(placement.placeableId) ?? null;
      return {
        id: placement.id,
        glyph: placementGlyph(index),
        placeableId: placement.placeableId,
        name: facts?.name ?? null,
        at: { xU: placement.xU, yU: placement.yU },
        rotation: placement.rotation,
        footprintU: facts ? { widthU: lotPlacementRect(placement, facts).widthU, depthU: lotPlacementRect(placement, facts).depthU } : null,
      };
    }),
    findings: auditLotPlan(plan, catalog),
  };
}

/** ASCII floor plan. Each cell is two characters wide; walls draw on the
 * borders between them, doors read `D`, windows `W`. Room cells carry the
 * room's letter, placements overlay their lowercase glyph, and a legend
 * follows so every glyph resolves to a name without a second lookup. */
export function renderLotPlanAscii(plan: LotPlan, catalog: Map<string, LotPlaceableFacts>): string {
  const summary = summarizeLotPlan(plan, catalog);
  const walls = new Set(plan.walls.map((wall) => lotEdgeKey(wall.edge)));
  const openingAt = new Map(plan.openings.map((opening) => [lotEdgeKey(opening.edge), opening.kind]));
  const CELL = 2;

  // Display quantization ONLY: a cell wears a placement's glyph when the
  // placement covers the cell's center. The data underneath stays fractional.
  const cellGlyphs: string[] = plan.cells.map((room) => (room >= 0 ? roomGlyph(room) : '·'));
  plan.placements.forEach((placement, index) => {
    const facts = catalog.get(placement.placeableId);
    if (!facts) return;
    const rect = lotPlacementRect(placement, facts);
    for (let r = 0; r < plan.heightU; r += 1) {
      for (let c = 0; c < plan.widthU; c += 1) {
        const cx = c + 0.5;
        const cy = r + 0.5;
        if (cx > rect.xU && cx < rect.xU + rect.widthU && cy > rect.yU && cy < rect.yU + rect.depthU) {
          cellGlyphs[r * plan.widthU + c] = placementGlyph(index);
        }
      }
    }
  });

  const horizontalRun = (c: number, r: number): string => {
    const key = lotEdgeKey({ orientation: 'h', columnU: c, rowU: r });
    const opening = openingAt.get(key);
    if (walls.has(key)) {
      if (opening === 'door') return 'D'.repeat(CELL);
      if (opening === 'window') return 'W'.repeat(CELL);
      return '─'.repeat(CELL);
    }
    return ' '.repeat(CELL);
  };
  const verticalRun = (c: number, r: number): string => {
    const key = lotEdgeKey({ orientation: 'v', columnU: c, rowU: r });
    const opening = openingAt.get(key);
    if (walls.has(key)) {
      if (opening === 'door') return 'D';
      if (opening === 'window') return 'W';
      return '│';
    }
    return ' ';
  };

  const lines: string[] = [];
  for (let r = 0; r <= plan.heightU; r += 1) {
    let border = '';
    for (let c = 0; c < plan.widthU; c += 1) border += `┼${horizontalRun(c, r)}`;
    lines.push(`${border}┼`);
    if (r === plan.heightU) break;
    let body = '';
    for (let c = 0; c < plan.widthU; c += 1) {
      body += verticalRun(c, r) + cellGlyphs[r * plan.widthU + c]!.padEnd(CELL, ' ');
    }
    lines.push(body + verticalRun(plan.widthU, r));
  }

  lines.push('');
  lines.push(`${plan.name} — ${plan.widthU}×${plan.heightU} u (1 u = 1 m)`);
  for (const room of summary.rooms) lines.push(`  ${room.glyph} ${room.name} · ${room.areaU2} u²`);
  for (const placement of summary.placements) {
    const size = placement.footprintU ? `${fmtMeters(placement.footprintU.widthU)}×${fmtMeters(placement.footprintU.depthU)} u` : 'UNMEASURED';
    lines.push(`  ${placement.glyph} ${placement.name ?? placement.placeableId} · ${size} at ${fmtMeters(placement.at.xU)},${fmtMeters(placement.at.yU)} r${placement.rotation}`);
  }
  for (const finding of summary.findings) {
    lines.push(`  ${finding.severity === 'refusal' ? '✗' : '⚠'} ${finding.message}`);
  }
  return lines.join('\n');
}
