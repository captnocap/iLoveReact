import { C } from '../workspace.cls';
import { fieldNodes } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';

export default function ColorLensField(props: { current: OklchColor; onPick: (color: OklchColor) => void }) {
  const nodes = fieldNodes(props.current);
  return (
    <C.HW_LensBody>
      <C.HW_FieldSurface>
        {nodes.map((node, index) => (
          <C.HW_FieldNode
            key={index}
            onPress={() => props.onPick(node.color)}
            style={{
              left: `${node.xPct}%`,
              top: `${node.yPct}%`,
              width: node.isCurrent ? 26 : 18,
              height: node.isCurrent ? 26 : 18,
              marginLeft: node.isCurrent ? -13 : -9,
              marginTop: node.isCurrent ? -13 : -9,
              backgroundColor: node.css,
              borderWidth: node.isCurrent ? 2.5 : 2,
              borderColor: node.isCurrent ? '#ffffff' : 'rgba(255,255,255,.65)',
            }}
          />
        ))}
        <C.HW_FieldAxisLabel style={{ left: 7, bottom: 6 }}>hue -&gt;</C.HW_FieldAxisLabel>
        <C.HW_FieldAxisLabel style={{ left: 7, top: 6 }}>light ^</C.HW_FieldAxisLabel>
      </C.HW_FieldSurface>
      <C.HW_FieldCaption>flat field, no wheel - small dots are the live harmony; click any node to adopt it.</C.HW_FieldCaption>
    </C.HW_LensBody>
  );
}
