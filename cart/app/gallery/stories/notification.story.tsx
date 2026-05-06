import { Row } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import { Notification } from '../components/notification/Notification';
import { notificationMockData } from '../data/overstock/notification';

function NotificationShelf({ children }: { children: any }) {
  return (
    <Row style={{ width: '100%', flexWrap: 'wrap', gap: 14, padding: 16, alignItems: 'flex-start' }}>
      {children}
    </Row>
  );
}

export const notificationSection = defineGallerySection({
  id: 'notification',
  title: 'Notification',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'top-level',
  composedOf: [
    'cart/app/gallery/components/controls-specimen/StatusBadge.tsx',
    'cart/app/gallery/components/controls-specimen/KeyValueBadge.tsx',
  ],
  stories: [
    defineGalleryStory({
      id: 'notification/default',
      title: 'Notification',
      source: 'cart/app/gallery/components/notification/Notification.tsx',
      status: 'draft',
      summary: 'One notification surface for inline, corner, overlay, and system notification approaches.',
      tags: ['panel', 'data', 'notification'],
      variants: [
        {
          id: 'inline',
          name: 'Inline',
          render: () => <Notification type="inline" method="warning" data={notificationMockData[1]} />,
        },
        {
          id: 'corner',
          name: 'Fixed Corner',
          render: () => <Notification type="corner" method="danger" data={notificationMockData[0]} />,
        },
        {
          id: 'overlay',
          name: 'Overlay CTA',
          render: () => <Notification type="overlay" method="info" data={notificationMockData[3]} />,
        },
        {
          id: 'kinds',
          name: 'Kinds',
          render: () => (
            <NotificationShelf>
              <Notification
                type="inline"
                method="info"
                data={{
                  title: 'Workspace indexed',
                  body: 'Search and symbol maps are ready for the active workspace.',
                  source: 'Indexer.completed',
                  lifetime: 'self-dismiss',
                  actions: [
                    { id: 'open-search', label: 'Search', kind: 'primary' },
                    { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
                  ],
                }}
              />
              <Notification
                type="inline"
                method="success"
                data={{
                  title: 'Task completed',
                  body: 'The worker produced the requested artifact and attached it to the task.',
                  source: 'Task.completed',
                  actions: [
                    { id: 'view', label: 'View', kind: 'primary' },
                    { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
                  ],
                }}
              />
              <Notification type="inline" method="warning" data={notificationMockData[1]} />
              <Notification type="inline" method="danger" data={notificationMockData[0]} />
            </NotificationShelf>
          ),
        },
      ],
    }),
  ],
});
