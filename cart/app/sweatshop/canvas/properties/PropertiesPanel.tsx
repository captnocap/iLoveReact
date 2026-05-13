// PropertiesPanel — selection-routed inspector for the /canvas route.
//
// Drops in where PropsStub used to sit. Switches sub-panel on
// selection.kind: design nodes get the composer-style inspector, flow
// nodes get the sweatshop-style inspector. Empty state shows the
// "Nothing selected" hint.
//
// onPatch is the single write channel. The host (canvas page or, later,
// the canvas content layer) decides whether to apply directly or stage
// into the assistant proposal queue. Sub-panels emit DesignPatch /
// FlowPatch payloads — typed, so the host doesn't need to introspect.

import { Col, ScrollView, Text } from '@reactjit/runtime/primitives';
import { DesignProps } from './DesignProps';
import { FlowProps } from './FlowProps';
import type { CanvasSelection, SelectionPatch } from './types';

export function PropertiesPanel({ selection, onPatch }: {
  selection: CanvasSelection;
  onPatch: (patch: SelectionPatch) => void;
}) {
  if (!selection) {
    return (
      <Col style={{ flexGrow: 1, padding: 8, gap: 6 }}>
        <Text size={9} color="theme:inkDim" bold>SELECTED</Text>
        <Text size={10} color="theme:ink">Nothing selected.</Text>
        <Text size={9} color="theme:inkDim">Click a node to inspect its properties.</Text>
      </Col>
    );
  }

  return (
    <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
      <Col style={{ padding: 8, gap: 8 }}>
        {selection.kind === 'design' ? (
          <DesignProps
            node={selection.node}
            onPatch={(patch) => onPatch({ kind: 'design', id: selection.node.id, patch })}
          />
        ) : (
          <FlowProps
            node={selection.node}
            onPatch={(patch) => onPatch({ kind: 'flow', id: selection.node.id, patch })}
          />
        )}
      </Col>
    </ScrollView>
  );
}
