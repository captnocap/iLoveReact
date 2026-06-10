import { memo } from 'react';
import type { PropKind, WorldProp } from '../design';
import { Rock } from './props/Rock';
import { FireHydrant } from './props/FireHydrant';
import { StreetSign } from './props/StreetSign';
import { StreetLight } from './props/StreetLight';
import { Bush } from './props/Bush';
import { StopSign } from './props/StopSign';
import { TrafficLight } from './props/TrafficLight';
import { Payphone } from './props/Payphone';
import { Dumpster } from './props/Dumpster';
import { Mailbox } from './props/Mailbox';
import { Fence } from './props/Fence';
import { Tree } from './props/Tree';
import { Ball } from './props/Ball';
import { WallDecor } from './props/WallDecor';
import { Furniture } from './props/Furniture';
import { StreetFurniture } from './props/StreetFurniture';

// The one place that maps a PropKind to its model. Every placed prop renders
// through this registry — the renderer never learns a prop's name, it just looks
// the kind up here, the same way the geometry registry resolves a shape. Adding
// a prop is: a kind in propKinds.ts + a model file + one line here.
type PropModel = (props: { prop: WorldProp }) => any;

const PROP_MODELS: Record<PropKind, PropModel> = {
  rock: Rock,
  rockLarge: Rock,
  rockSmall: Rock,
  fireHydrant: FireHydrant,
  streetSign: StreetSign,
  streetLight: StreetLight,
  bush: Bush,
  bushLarge: Bush,
  bushLow: Bush,
  bushSparse: Bush,
  stopSign: StopSign,
  trafficLight: TrafficLight,
  payphone: Payphone,
  dumpster: Dumpster,
  mailbox: Mailbox,
  fence: Fence,
  trafficCone: StreetFurniture,
  barrier: StreetFurniture,
  trashCan: StreetFurniture,
  bench: Furniture,
  planter: StreetFurniture,
  treeOak: Tree,
  treePine: Tree,
  treeBirch: Tree,
  treeCypress: Tree,
  treePalm: Tree,
  treeDead: Tree,
  boulder: Rock,
  rockFlat: Rock,
  rockSpire: Rock,
  rockMossy: Rock,
  rockPile: Rock,
  ballBeach: Ball,
  ballSoccer: Ball,
  ballBasketball: Ball,
  wallPainting: WallDecor,
  ledLight: WallDecor,
  chair: Furniture,
  couch: Furniture,
  table: Furniture,
  floorLamp: Furniture,
};

// One placed prop, drawn by its kind's model at its anchor + yaw. Memoized on
// the (referentially stable) prop so a player/camera frame does not re-render
// every prop — the same statics-stability contract the road meshes follow.
export const Prop = memo(function Prop(props: { prop: WorldProp }) {
  const Model = PROP_MODELS[props.prop.kind];
  if (!Model) return null;
  return <Model prop={props.prop} />;
});
