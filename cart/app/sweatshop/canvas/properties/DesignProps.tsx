// Design-node inspector — descended from cart/app/composer/page.tsx
// inspector. Kept narrow on purpose: the merged canvas route is still
// stubbing canvas content, so we expose only the props the composer
// inspector treats as load-bearing (kind, name, text for text-bearing
// nodes, w/h, x/y for Pages, padding+gap for containers, bg/color).
//
// The full step-slider / preset row / color-swatch UX from composer
// lands when the design layer is actually wired into the canvas. For
// now this is the contract: type-safe DesignNode in, DesignPatch out.

import { Col } from '@reactjit/runtime/primitives';
import { Section, ReadOnlyRow, TextField, NumberField } from './Field';
import type { DesignNode, DesignPatch } from './types';

export function DesignProps({ node, onPatch }: {
  node: DesignNode;
  onPatch: (patch: DesignPatch) => void;
}) {
  const isText = node.type === 'Text' || node.type === 'Pressable';
  const isContainer = node.type === 'Box' || node.type === 'Frame' || node.type === 'Page';

  return (
    <Col style={{ gap: 8 }}>
      <Section label="Identity">
        <ReadOnlyRow label="kind" value={node.type} />
        <ReadOnlyRow label="id" value={node.id} />
        <TextField label="name" value={node.name ?? ''} placeholder={node.type}
          onChange={(name) => onPatch({ name })} />
        {isText ? (
          <TextField label="text" value={node.text ?? ''} placeholder="…"
            onChange={(text) => onPatch({ text })} />
        ) : null}
      </Section>

      <Section label="Size">
        <NumberField label="width" value={node.width}
          onChange={(width) => onPatch({ width })} />
        <NumberField label="height" value={node.height}
          onChange={(height) => onPatch({ height })} />
      </Section>

      {node.type === 'Page' ? (
        <Section label="Position">
          <NumberField label="x" value={node.x} onChange={(x) => onPatch({ x })} />
          <NumberField label="y" value={node.y} onChange={(y) => onPatch({ y })} />
        </Section>
      ) : null}

      {isContainer ? (
        <Section label="Spacing">
          <NumberField label="padding" value={node.padding}
            onChange={(padding) => onPatch({ padding })} />
          <NumberField label="gap" value={node.gap}
            onChange={(gap) => onPatch({ gap })} />
        </Section>
      ) : null}

      <Section label="Color">
        <TextField label="bg" value={node.bg ?? ''} placeholder="#rrggbb"
          onChange={(bg) => onPatch({ bg })} />
        <TextField label="text" value={node.color ?? ''} placeholder="#rrggbb"
          onChange={(color) => onPatch({ color })} />
      </Section>
    </Col>
  );
}
