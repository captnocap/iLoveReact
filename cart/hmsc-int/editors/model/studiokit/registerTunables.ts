// editors/model/studiokit/registerTunables.ts — the editorTunables registration
// for the Studio viewport, SPLIT OUT of config.ts (req_1394).
//
// Why this is its own module: config.ts holds the STUDIO table as pure DATA, and
// several panels outside this tree (UVPanel/TextureAtlas/ShapePanel/RigMetaPanel)
// import that table. If the register() call lived in config.ts, every one of those
// importers would fire it — and during the side-by-side period the frozen
// Studio.tsx ALSO registers 'studio-viewport', so two registrations collide
// ("already registered" → blank editor). Keeping the side effect HERE, imported
// only by the studio entry (StudioViewport.tsx), means the register fires exactly
// once — when the decomposed studio actually mounts — and importing the data is
// side-effect-free.

import { editorTunables } from '../../tunables';
import { STUDIO } from './config';

editorTunables().register({
  system: 'studio-viewport', route: '/model', table: STUDIO,
  specs: {
    tileMeters: { label: 'tile (m)', min: 0.25, max: 8, step: 0.25, precision: 2 },
    fineDivisions: { label: 'center subdiv', min: 2, max: 32, step: 1, precision: 0 },
    bootYaw: { label: 'boot yaw°', min: -180, max: 180, step: 1, precision: 0 },
    bootPitch: { label: 'boot pitch°', min: -85, max: 85, step: 1, precision: 0 },
    fov: { label: 'fov°', min: 20, max: 80, step: 1, precision: 0 },
    yawPerPixel: { label: 'yaw / px', min: 0.05, max: 1.5, step: 0.01, precision: 2 },
    pitchPerPixel: { label: 'pitch / px', min: 0.05, max: 1.5, step: 0.01, precision: 2 },
    fitDistanceFactor: { label: 'fit dist ×r', min: 1.5, max: 6, step: 0.1, precision: 1 },
  },
});
