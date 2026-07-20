// SECTION D — the compact paint tool strip (req_3270).
//
// The action bar chooses the active paint tool and preview resolution. Detailed
// brush and ink controls live persistently in Section C; no toolbar button owns
// a click-away popover anymore. This keeps the stage-wide strip readable while
// the adjacent dock provides the large, stable controls used during a stroke.
import { Box, Row, Text, Pressable, Effect } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { type BrushTool } from '@reactjit/runtime/paint';
import { ToolIcon } from '../../../runtime/paint/controls';

const LINE = '#242a33';
const TEXT = '#e8edf6';
const DIM = '#8b93a3';
const ACCENT = '#6ea8fe';

type Tool = { id: BrushTool; tip: string };
const TOOLS: Tool[] = [
  { id: 'fill', tip: 'Fill — flood a whole face' },
  { id: 'brush', tip: 'Brush — free-form strokes' },
  { id: 'eraser', tip: 'Eraser — reveal the layer below' },
  { id: 'line', tip: 'Line — drag a straight stroke' },
  { id: 'rect', tip: 'Rectangle — drag an outline' },
  { id: 'ellipse', tip: 'Ellipse — drag an outline' },
  { id: 'eyedropper', tip: 'Pick — sample a color' },
  { id: 'marquee', tip: 'Marquee — rectangular paint selection' },
  { id: 'lasso', tip: 'Lasso — freehand paint selection' },
];

/** A live shader preview shared by the paint ink and map/material pickers. */
export function ShaderThumb({ shader, data, size = 40 }: { shader: string; data: number[]; size?: number }) {
  return (
    <Box style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden' }}>
      <Effect shader={shader} data={data} style={{ width: size, height: size }} />
    </Box>
  );
}

function Divider() {
  return <Box style={{ width: 1, height: 20, backgroundColor: LINE }} />;
}

export default function PaintToolbar(props: {
  brushTool: BrushTool;
  detail: number;
  onBrushTool: (tool: BrushTool) => void;
  onCycleDetail: () => void;
  tools?: BrushTool[];
}) {
  const visibleTools = props.tools ?? ['fill', 'brush', 'eyedropper'];
  return (
    <Row style={{ alignItems: 'center', gap: 8 }}>
      <Pressable
        tooltip="Paint resolution — click to cycle"
        onPress={props.onCycleDetail}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 8, height: 26, borderRadius: 6, borderWidth: 1, borderColor: LINE }}
      >
        <Icon name="Grid3x3" size={12} color={DIM} />
        <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'ui-monospace' }}>{props.detail <= 1 ? 'fill' : `${props.detail}px`}</Text>
      </Pressable>
      <Divider />
      <Row style={{ gap: 3 }}>
        {TOOLS.filter((tool) => visibleTools.includes(tool.id)).map((tool) => {
          const active = props.brushTool === tool.id;
          return (
            <Pressable
              key={tool.id}
              tooltip={tool.tip}
              onPress={() => props.onBrushTool(tool.id)}
              style={{ width: 30, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? ACCENT : 'transparent' }}
            >
              <ToolIcon tool={tool.id} size={17} color={active ? '#0d0e10' : DIM} />
            </Pressable>
          );
        })}
      </Row>
    </Row>
  );
}
