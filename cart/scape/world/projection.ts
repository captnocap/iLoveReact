export const TILE_PX = 30;

export interface Cam {
  px: number;
  py: number;
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const centerX = (r: Rect) => r.width * 0.5;
export const centerY = (r: Rect) => r.height * 0.56;

export function project(wx: number, wy: number, c: Cam, r: Rect) {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const dx = wx - c.px;
  const dy = wy - c.py;
  const rx = dx * cs - dy * sn;
  const ry = dx * sn + dy * cs;
  return {
    x: centerX(r) + rx * TILE_PX * c.zoom,
    y: centerY(r) + ry * TILE_PX * c.zoom * c.pitch,
    depth: ry,
  };
}

export function unproject(sx: number, sy: number, c: Cam, r: Rect) {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const rx = (sx - centerX(r)) / (TILE_PX * c.zoom);
  const ry = (sy - centerY(r)) / (TILE_PX * c.zoom * c.pitch);
  return { x: c.px + rx * cs + ry * sn, y: c.py - rx * sn + ry * cs };
}

export function hazeOpacity(depth: number): number {
  return Math.max(0, Math.min(1, (Math.abs(depth) - 15) / 9));
}
