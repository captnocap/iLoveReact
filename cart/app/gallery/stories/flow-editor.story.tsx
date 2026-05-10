import { Box, Canvas } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import { FlowTile } from '../components/flow-editor/FlowTile';
import { FLOW_EDITOR_DEFAULT_THEME } from '../components/flow-editor/flowEditorTheme';
import { FLOW_EDITOR_DEMO_NODES } from '../components/flow-editor/demoFlow';

// The component is FlowTile — a single node on a flow canvas. The full
// FlowEditor (toolbar + state + headless demo + custom tile + custom theme)
// is a whole app's worth of plumbing; that's not a gallery component, that
// ships as a feature.

const noop = () => {};
const theme = FLOW_EDITOR_DEFAULT_THEME;

function CanvasStage(props: { children: any }) {
  return (
    <Box style={{ width: 480, height: 320, borderWidth: 1, borderColor: theme.tileBorder }}>
      <Canvas
        style={{ width: '100%', height: '100%', backgroundColor: theme.bg }}
        gridStep={theme.gridStep}
        gridStroke={1}
        gridColor={theme.gridColor}
        gridMajorColor={theme.gridMajorColor}
        gridMajorEvery={theme.gridMajorEvery}
      >
        {props.children}
      </Canvas>
    </Box>
  );
}

const tileProps = (node: any) => ({
  node,
  theme,
  selected: false,
  pendingIn: false,
  pendingOut: false,
  onMove: noop,
  onPortClick: noop,
  onTileClick: noop,
});

export const flowEditorSection = defineGallerySection({
  id: 'flow-tile',
  title: 'Flow Tile',
  stories: [
    defineGalleryStory({
      id: 'flow-tile/default',
      title: 'Flow Tile',
      source: 'cart/app/gallery/components/flow-editor/FlowTile.tsx',
      status: 'ready',
      summary: 'A single tile on a Canvas grid. The full editor lives elsewhere.',
      tags: ['canvas', 'flow', 'tile'],
      variants: [
        {
          id: 'single-tile',
          name: 'Single tile',
          render: () => (
            <CanvasStage>
              <FlowTile {...tileProps(FLOW_EDITOR_DEMO_NODES[0])} />
            </CanvasStage>
          ),
        },
        {
          id: 'two-tiles',
          name: 'Two tiles',
          render: () => (
            <CanvasStage>
              <FlowTile {...tileProps(FLOW_EDITOR_DEMO_NODES[0])} />
              {FLOW_EDITOR_DEMO_NODES[1] ? (
                <FlowTile {...tileProps(FLOW_EDITOR_DEMO_NODES[1])} />
              ) : null}
            </CanvasStage>
          ),
        },
      ],
    }),
  ],
});
