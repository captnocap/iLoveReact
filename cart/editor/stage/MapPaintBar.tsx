// MapPaintBar — the Map Paint ACTION BAR segment.
//
// The toolbar keeps only the actual paint tool toggle. Brush footprint, gizmo,
// and channel-specific authoring options live in the viewport's bottom
// MapPaintDock, matching the BuildBar pattern.
//
// React arms the tool; every stroke/stamp/re-bake runs host-side
// (framework/game/map). All door traffic is UI-rate.
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import type { MapPaintState } from './mapPaint';

// BAR LAW (req_2675): verbs and mode toggles are ICONS with tooltips; text is
// reserved for VALUE READOUTS (SNAP/SIZE/HEIGHT-style label+value pills). A
// mode's name is never spelled twice in one bar. Every glyph below is verified
// against the baked SDF atlas (runtime/icons/baked-names.ts) — no tofu.

/** The action bar's icon control (matches ToolOptions' tool buttons exactly). */
function IconButton(props: { icon: string; tooltip: string; on?: boolean; onPress: () => void }) {
  const Btn = props.on ? C.HW_IconButtonOn : C.HW_IconButton;
  return (
    <Btn tooltip={props.tooltip} onPress={props.onPress}>
      <Icon name={props.icon} size={14} color={accentFor(props.on ? 'primary' : 'textDim')} />
    </Btn>
  );
}

export default function MapPaintBar(props: {
  state: MapPaintState;
  onPatch: (patch: Partial<MapPaintState>) => void;
}) {
  const s = props.state;
  return (
    <IconButton
      icon="Paintbrush"
      tooltip="Map Paint - sculpt terrain, paint ground/water/flora/zones, lay roads"
      on={s.active}
      onPress={() => props.onPatch({ active: !s.active })}
    />
  );
}
