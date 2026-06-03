import { Box, Text } from '@reactjit/primitives';
import type { BuildingSkin, PerceptionState } from '../design';

// The building-skin catalog. A skin is a 2D facade (windows, signage, address)
// laid out with Box/Text; it is captured to a GPU texture (render3d/BuildingFacades
// captures) and mapped onto the building's wall faces — the billboard_demo
// pattern. Appearance is a separate axis from kind (size/physics): any footprint
// can wear any skin.
//
// A facade renders into a window grid sized to the wall: `cols` ≈ width/3m,
// `floors` ≈ height/3m, so windows stay roughly square when the texture is
// stretched 0..1 across the face. The whole skin for a (skin, cols, floors)
// bucket is one shared texture across every wall of that shape — cheap, bakes
// once, scales to a city block.
//
// The context carries `perception` so the contract is ready for the reactive
// slice (being high scrambling text / a wall going to plasma); the static
// catalog below ignores it. When a skin starts reading it, its capture's memo
// key gains a perception bucket — see BuildingFacades.

export type BuildingSkinContext = {
  skin: BuildingSkin;
  cols: number;
  floors: number;
  widthMeters: number;
  heightMeters: number;
  perception: PerceptionState;
};

export type BuildingSkinFacade = (ctx: BuildingSkinContext) => any;

const CELL_PX = 64;
const MIN_CAPTURE_PX = 128;
const MAX_CAPTURE_PX = 900;

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(value)));
}

// Window-grid buckets: ~3m per window column and per storey. Keeps a shared
// texture's window count matched to the wall it stretches across.
export function skinGridCols(widthMeters: number): number {
  return clampInt(widthMeters / 3, 1, 10);
}

export function skinGridFloors(heightMeters: number): number {
  return clampInt(heightMeters / 3, 1, 12);
}

export function skinTextureKey(skin: BuildingSkin, cols: number, floors: number): string {
  return `hmsc.skin.${skin}.${cols}x${floors}`;
}

export function skinCapturePx(count: number): number {
  return Math.max(MIN_CAPTURE_PX, Math.min(MAX_CAPTURE_PX, count * CELL_PX));
}

// Deterministic per-cell variation without Math.random (stable across bakes).
function cellHash(row: number, col: number): number {
  return ((row * 73856093) ^ (col * 19349663)) >>> 0;
}

// Rows are laid top floor → ground floor so row 0 sits at the top of the facade.
function rows(floors: number): number[] {
  return Array.from({ length: floors }, (_, i) => i);
}
function columns(cols: number): number[] {
  return Array.from({ length: cols }, (_, i) => i);
}

// ── Office: a glass curtain wall — a tight grid of blue-tinted panes with a
// scatter of lit offices and dark vacancies, thin steel mullions between. ──────
const OfficeFacade: BuildingSkinFacade = ({ cols, floors }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#0f161f', padding: 6, gap: 4 }}>
    {rows(floors).map((row) => (
      <Box key={row} style={{ flexGrow: 1, flexDirection: 'row', gap: 4 }}>
        {columns(cols).map((col) => {
          const h = cellHash(row, col) % 7;
          const glass = h === 0 ? '#bfe3ff' : h === 1 ? '#16222e' : h < 4 ? '#34597a' : '#2a4a66';
          return <Box key={col} style={{ flexGrow: 1, backgroundColor: glass, borderRadius: 1 }} />;
        })}
      </Box>
    ))}
  </Box>
);

// ── Residential: warm brick with mixed windows, balcony rails on some floors,
// and an address plate at the base. ───────────────────────────────────────────
const ResidentialFacade: BuildingSkinFacade = ({ cols, floors }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#7d5b42', padding: 10, gap: 10 }}>
    {rows(floors).map((row) => {
      const balcony = row % 2 === 1;
      return (
        <Box key={row} style={{ flexGrow: 1, flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
          {columns(cols).map((col) => {
            const h = cellHash(row, col) % 6;
            const lit = h === 0 ? '#ffd9a0' : h === 1 ? '#2b2118' : '#caa9d6';
            return (
              <Box key={col} style={{ flexGrow: 1, height: '70%', backgroundColor: '#3a2c22', padding: 3 }}>
                <Box style={{ flexGrow: 1, backgroundColor: lit }} />
                {balcony ? <Box style={{ height: 5, backgroundColor: '#2a2018' }} /> : null}
              </Box>
            );
          })}
        </Box>
      );
    })}
    <Box style={{ position: 'absolute', left: 12, bottom: 10, paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, backgroundColor: '#1b1410' }}>
      <Text style={{ fontSize: 20, color: '#f0e3d0', fontWeight: 'bold' }}>100</Text>
    </Box>
  </Box>
);

// ── Retail: plain upper wall with a few windows over a ground-floor storefront —
// striped awning, glass, a lit sign, and an address. ──────────────────────────
const RetailFacade: BuildingSkinFacade = ({ cols }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#6b7280' }}>
    <Box style={{ flexGrow: 1, flexDirection: 'row', padding: 14, gap: 16 }}>
      {columns(Math.max(2, cols)).map((col) => (
        <Box key={col} style={{ flexGrow: 1, height: '46%', backgroundColor: cellHash(0, col) % 4 === 0 ? '#cfe6ff' : '#2c3540' }} />
      ))}
    </Box>
    {/* striped awning */}
    <Box style={{ height: 18, flexDirection: 'row' }}>
      {columns(10).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: col % 2 === 0 ? '#c23b2e' : '#f1ece2' }} />
      ))}
    </Box>
    {/* storefront band */}
    <Box style={{ height: '34%', backgroundColor: '#11161d', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 16, gap: 14 }}>
      <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, backgroundColor: '#f5b21e', borderRadius: 3 }}>
        <Text style={{ fontSize: 26, color: '#1a1206', fontWeight: 'bold' }}>SHOP</Text>
      </Box>
      <Box style={{ flexGrow: 1, height: '70%', backgroundColor: '#7fd0e8' }} />
      <Text style={{ fontSize: 16, color: '#9fb0c4' }}>42 MAIN</Text>
    </Box>
  </Box>
);

// ── Industrial: corrugated metal ribs, sparse high clerestory windows, a stencil
// label, and a wide roller door at the base. ──────────────────────────────────
const IndustrialFacade: BuildingSkinFacade = ({ cols }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#8a9097' }}>
    {/* corrugation ribs */}
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'row' }}>
      {columns(Math.max(10, cols * 3)).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: col % 2 === 0 ? '#7c8288' : '#9aa0a7' }} />
      ))}
    </Box>
    {/* clerestory windows high up */}
    <Box style={{ flexDirection: 'row', padding: 12, gap: 14, height: '18%' }}>
      {columns(Math.max(3, cols)).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: '#34414d', borderWidth: 2, borderColor: '#5a636c' }} />
      ))}
    </Box>
    <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, color: '#3a3f45', fontWeight: 'bold' }}>UNIT 7</Text>
    </Box>
    {/* roller door — a big garage door filling most of the ground floor */}
    <Box style={{ height: '56%', alignItems: 'center', justifyContent: 'flex-end' }}>
      <Box style={{ width: '74%', height: '96%', backgroundColor: '#34373c', padding: 5, gap: 4 }}>
        {rows(7).map((row) => (
          <Box key={row} style={{ flexGrow: 1, backgroundColor: '#43474d' }} />
        ))}
      </Box>
    </Box>
  </Box>
);

// ── Internet cafe: a dark storefront wall packed with a grid of glowing monitor
// windows (the rows of screens you see through the glass), a neon sign band, and
// a lit doorway. Reads as a late-night cyber cafe. ─────────────────────────────
const InternetCafeFacade: BuildingSkinFacade = ({ cols, floors }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#10141c' }}>
    <Box style={{ flexGrow: 1, padding: 10, gap: 8 }}>
      {rows(Math.max(2, floors)).map((row) => (
        <Box key={row} style={{ flexGrow: 1, flexDirection: 'row', gap: 8 }}>
          {columns(Math.max(3, cols)).map((col) => {
            const h = cellHash(row, col) % 5;
            const screen = h === 0 ? '#27e0d2' : h === 1 ? '#7b6cff' : h === 2 ? '#ff5fa2' : '#1b2738';
            return (
              <Box key={col} style={{ flexGrow: 1, backgroundColor: '#05070b', padding: 3 }}>
                <Box style={{ flexGrow: 1, backgroundColor: screen, borderRadius: 1 }} />
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
    {/* neon sign band */}
    <Box style={{ height: '24%', backgroundColor: '#070a10', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#27e0d2' }}>
      <Text style={{ fontSize: 30, color: '#5ff0e6', fontWeight: 'bold' }}>NET CAFE</Text>
    </Box>
  </Box>
);

// ── Spray-N-Pray (gun shop): a hard storefront — steel-grey wall, barred narrow
// windows, an orange caution stripe, and a bold blood-red sign. ────────────────
const GunShopFacade: BuildingSkinFacade = ({ cols }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#3a3f45' }}>
    {/* caution stripe under the parapet */}
    <Box style={{ height: 12, flexDirection: 'row' }}>
      {columns(16).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: col % 2 === 0 ? '#e8821e' : '#1c1f23' }} />
      ))}
    </Box>
    {/* big sign */}
    <Box style={{ height: '30%', backgroundColor: '#7d1410', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#120a09' }}>
      <Text style={{ fontSize: 34, color: '#f4d9c0', fontWeight: 'bold' }}>SPRAY-N-PRAY</Text>
    </Box>
    {/* barred windows over a shutter */}
    <Box style={{ flexGrow: 1, flexDirection: 'row', padding: 14, gap: 16 }}>
      {columns(Math.max(2, cols)).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: '#1a1d21', padding: 4, gap: 4 }}>
          {rows(3).map((r) => (
            <Box key={r} style={{ flexGrow: 1, backgroundColor: '#2c3540' }} />
          ))}
        </Box>
      ))}
    </Box>
    {/* roller shutter at the base */}
    <Box style={{ height: '22%', backgroundColor: '#2a2d31', padding: 5, gap: 3 }}>
      {rows(4).map((r) => (
        <Box key={r} style={{ flexGrow: 1, backgroundColor: '#34383d' }} />
      ))}
    </Box>
  </Box>
);

// ── Mall: a broad corporate facade — tan stone panels, a long horizontal sign
// band, a ribbon of clerestory glazing, and a tall glass entrance at the base. ─
const MallFacade: BuildingSkinFacade = ({ cols }) => (
  <Box style={{ width: '100%', height: '100%', backgroundColor: '#cabfa6' }}>
    {/* sign band */}
    <Box style={{ height: '20%', backgroundColor: '#1f6f78', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 38, color: '#f3efe6', fontWeight: 'bold' }}>◆ MALL ◆</Text>
    </Box>
    {/* clerestory glazing ribbon */}
    <Box style={{ height: '24%', flexDirection: 'row', padding: 10, gap: 8 }}>
      {columns(Math.max(6, cols * 2)).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: cellHash(0, col) % 3 === 0 ? '#bfe6ee' : '#5f8b93' }} />
      ))}
    </Box>
    {/* blank stone panel field */}
    <Box style={{ flexGrow: 1, flexDirection: 'row', padding: 8, gap: 6 }}>
      {columns(Math.max(4, cols)).map((col) => (
        <Box key={col} style={{ flexGrow: 1, backgroundColor: col % 2 === 0 ? '#c2b69b' : '#cdc2a8' }} />
      ))}
    </Box>
    {/* glass entrance */}
    <Box style={{ height: '30%', alignItems: 'center', justifyContent: 'flex-end' }}>
      <Box style={{ width: '60%', height: '100%', backgroundColor: '#243744', flexDirection: 'row', padding: 4, gap: 4 }}>
        {columns(4).map((col) => (
          <Box key={col} style={{ flexGrow: 1, backgroundColor: '#3f5d6e' }} />
        ))}
      </Box>
    </Box>
  </Box>
);

// The registry. 'plain' is intentionally absent — a plain building shows its bare
// wall color and gets no facade panel.
export const BUILDING_SKINS: Partial<Record<BuildingSkin, BuildingSkinFacade>> = {
  office: OfficeFacade,
  residential: ResidentialFacade,
  retail: RetailFacade,
  industrial: IndustrialFacade,
  internetCafe: InternetCafeFacade,
  gunShop: GunShopFacade,
  mall: MallFacade,
};

export function buildingSkinFacade(skin: BuildingSkin): BuildingSkinFacade | undefined {
  return BUILDING_SKINS[skin];
}

export const BUILDING_SKIN_NAMES = (['plain', 'office', 'residential', 'retail', 'industrial', 'internetCafe', 'gunShop', 'mall'] as BuildingSkin[]);

export function isBuildingSkin(value: string): value is BuildingSkin {
  return BUILDING_SKIN_NAMES.includes(value as BuildingSkin);
}

export function buildingSkinNamesForConsole(): string {
  return BUILDING_SKIN_NAMES.join(', ');
}
