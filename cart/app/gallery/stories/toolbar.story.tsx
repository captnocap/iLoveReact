import { Col, Row } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import { Toolbar } from '../components/toolbar/Toolbar';
import {
  toolbarIconData,
  toolbarNestedMenuData,
  toolbarStatusData,
  toolbarTextMenuData,
  toolbarVerticalData,
} from '../data/overstock/toolbar';

function ToolbarShelf({ children }: { children: any }) {
  return (
    <Col style={{ width: '100%', gap: 18, padding: 16, alignItems: 'flex-start' }}>
      {children}
    </Col>
  );
}

function ToolbarRow({ children }: { children: any }) {
  return (
    <Row style={{ width: '100%', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {children}
    </Row>
  );
}

export const toolbarSection = defineGallerySection({
  id: 'toolbar',
  title: 'Toolbar',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'top-level',
  composedOf: [
    'cart/app/gallery/components/toolbar/ToolbarMenu.tsx',
    'cart/app/gallery/components/controls-specimen/StatusBadge.tsx',
    'cart/app/gallery/components/controls-specimen/controlsSpecimenParts.tsx',
  ],
  stories: [
    defineGalleryStory({
      id: 'toolbar/default',
      title: 'Toolbar',
      source: 'cart/app/gallery/components/toolbar/Toolbar.tsx',
      status: 'draft',
      summary: 'One toolbar surface for text menu bars, square icon bars, system status strips, and vertical tool rails.',
      tags: ['controls', 'menu', 'toolbar'],
      variants: [
        {
          id: 'text-menus',
          name: 'Text Menus',
          render: () => <Toolbar type="text-menu" data={toolbarTextMenuData} />,
        },
        {
          id: 'icon-bar',
          name: '1:1 Icon Bar',
          render: () => <Toolbar type="icon-bar" data={toolbarIconData} />,
        },
        {
          id: 'status',
          name: 'System Status',
          render: () => <Toolbar type="status" data={toolbarStatusData} />,
        },
        {
          id: 'vertical',
          name: 'Vertical',
          render: () => <Toolbar type="vertical" data={toolbarVerticalData} />,
        },
        {
          id: 'nested',
          name: 'Nested Menus',
          render: () => <Toolbar type="text-menu" data={toolbarNestedMenuData} />,
        },
        {
          id: 'suite',
          name: 'Toolbar Suite',
          render: () => (
            <ToolbarShelf>
              <Toolbar type="text-menu" data={toolbarTextMenuData} />
              <ToolbarRow>
                <Toolbar type="icon-bar" data={toolbarIconData} />
                <Toolbar type="status" data={toolbarStatusData} />
              </ToolbarRow>
              <ToolbarRow>
                <Toolbar type="vertical" data={toolbarVerticalData} />
                <Toolbar type="text-menu" data={toolbarNestedMenuData} />
              </ToolbarRow>
            </ToolbarShelf>
          ),
        },
      ],
    }),
  ],
});
