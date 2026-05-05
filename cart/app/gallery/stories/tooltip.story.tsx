import { Row } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import { Tooltip } from '../components/tooltip/Tooltip';
import { constraintMockData } from '../data/core/constraint';
import { eventHookMockData } from '../data/core/event-hook';
import { taskMockData } from '../data/overstock/task';
import { workerMockData } from '../data/core/worker';

function TooltipShelf({ children }: { children: any }) {
  return (
    <Row style={{ width: '100%', flexWrap: 'wrap', gap: 12, padding: 16, alignItems: 'flex-start' }}>
      {children}
    </Row>
  );
}

export const tooltipSection = defineGallerySection({
  id: 'tooltip',
  title: 'Tooltip',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'top-level',
  composedOf: [
    'cart/app/gallery/components/tooltip-frame/TooltipFrame.tsx',
    'cart/app/gallery/components/tooltip-header/TooltipHeader.tsx',
    'cart/app/gallery/components/tooltip-data-row/TooltipDataRow.tsx',
  ],
  stories: [
    defineGalleryStory({
      id: 'tooltip/default',
      title: 'Tooltip',
      source: 'cart/app/gallery/components/tooltip/Tooltip.tsx',
      status: 'ready',
      summary: 'Unified basic and rich tooltip composition driven by type, method, and data.',
      tags: ['panel', 'data'],
      variants: [
        {
          id: 'basic',
          name: 'Basic',
          render: () => <Tooltip type="basic" method="command" />,
        },
        {
          id: 'rich',
          name: 'Rich',
          render: () => <Tooltip type="rich" method="metrics" />,
        },
        {
          id: 'appear',
          name: 'Appear',
          render: () => (
            <TooltipShelf>
              <Tooltip
                type="basic"
                method="command"
                appear="fade"
                appearEasing="easeOutSine"
                data={{ title: 'Fade in', detail: 'Opacity resolves with easeOutSine.' }}
              />
              <Tooltip
                type="basic"
                method="status"
                appear="rise"
                appearDelayMs={90}
                appearEasing="easeOutCubic"
                data={{ title: 'Rise in', detail: 'A short lift settles into place.' }}
              />
              <Tooltip
                type="rich"
                method="task"
                appear="scale"
                appearDelayMs={180}
                appearEasing="easeOutExpo"
                data={{ title: 'Scale in', detail: 'Fast ease-out expansion for dense tooltips.' }}
              />
              <Tooltip
                type="rich"
                method="hook"
                appear="pop"
                appearDelayMs={270}
                appearDurationMs={320}
                appearEasing="easeOutBack"
                data={{ title: 'Pop in', detail: 'Back easing gives a small overshoot before rest.' }}
              />
            </TooltipShelf>
          ),
        },
        {
          id: 'basic-methods',
          name: 'Basic Methods',
          render: () => {
            const worker = workerMockData[1];
            const task = taskMockData[3];
            const constraint = constraintMockData[1];

            return (
              <TooltipShelf>
                <Tooltip type="basic" method="command" />
                <Tooltip
                  type="basic"
                  method="field"
                  data={{
                    title: 'Task status',
                    detail: `Current value: ${task.status}`,
                    meta: task.kind,
                    source: 'Task.kind',
                  }}
                />
                <Tooltip
                  type="basic"
                  method="status"
                  data={{
                    title: worker.label,
                    detail: `${worker.kind} worker / ${worker.lifecycle}`,
                    meta: worker.lifecycle,
                    source: 'Worker.lifecycle',
                  }}
                />
                <Tooltip
                  type="basic"
                  method="reference"
                  data={{
                    title: constraint.scopeTargetId,
                    detail: constraint.statement,
                    meta: constraint.scopeKind,
                    source: 'Constraint.scopeKind',
                    tone: 'danger',
                  }}
                />
              </TooltipShelf>
            );
          },
        },
        {
          id: 'rich-methods',
          name: 'Rich Methods',
          render: () => {
            const worker = workerMockData[1];
            const task = taskMockData[3];
            const hook = eventHookMockData[1];
            const constraint = constraintMockData[2];

            return (
              <TooltipShelf>
                <Tooltip
                  type="rich"
                  method="worker"
                  data={{
                    title: worker.label,
                    detail: `${worker.modelId} / ${worker.connectionId}`,
                    badge: worker.kind,
                    rows: [
                      { label: 'STATE', value: worker.lifecycle, tone: 'ok' },
                      { label: 'ROLE', value: worker.roleId?.replace('role_', '') || 'none', tone: 'accent' },
                      { label: 'PARENT', value: worker.parentWorkerId ? 'yes' : 'none', tone: 'blue' },
                      { label: 'REQ', value: String(worker.maxConcurrentRequests), tone: 'warn' },
                    ],
                    footer: 'Worker identity and lifecycle.',
                  }}
                />
                <Tooltip
                  type="rich"
                  method="task"
                  data={{
                    title: task.label,
                    detail: task.approachNote || task.description || task.id,
                    badge: task.kind,
                    rows: [
                      { label: 'STATE', value: task.status.replace('in_progress', 'active'), tone: 'warn' },
                      { label: 'WORKER', value: task.assignedWorkerId || 'none', tone: 'accent' },
                      { label: 'GOAL', value: task.goalId ? 'linked' : 'none', tone: 'blue' },
                      { label: 'ART', value: String(task.artifactRefs?.length || 0), tone: 'ok' },
                    ],
                    footer: 'Task kind, owner, and artifacts.',
                  }}
                />
                <Tooltip
                  type="rich"
                  method="hook"
                  data={{
                    title: hook.label,
                    detail: hook.summary || hook.id,
                    badge: hook.consequence.kind,
                    rows: [
                      { label: 'MATCH', value: hook.match.kind, tone: 'warn' },
                      { label: 'SUBJ', value: hook.match.subjectKind || 'any', tone: 'blue' },
                      { label: 'ON', value: hook.enabled ? 'yes' : 'no', tone: hook.enabled ? 'ok' : 'flag' },
                      { label: 'FIRES', value: String(hook.fireCount), tone: 'accent' },
                    ],
                    footer: 'Matcher and dispatcher.',
                  }}
                />
                <Tooltip
                  type="rich"
                  method="constraint"
                  data={{
                    title: constraint.kind,
                    detail: constraint.statement,
                    badge: constraint.severity,
                    rows: [
                      { label: 'SCOPE', value: constraint.scopeKind, tone: 'blue' },
                      { label: 'TARGET', value: constraint.scopeTargetId.replace('settings_', ''), tone: 'accent' },
                      { label: 'MODE', value: constraint.violationResponse, tone: 'flag' },
                      { label: 'PHASE', value: constraint.appliesDuring.join('/'), tone: 'warn' },
                    ],
                    footer: 'Boundary and response.',
                  }}
                />
              </TooltipShelf>
            );
          },
        },
      ],
    }),
  ],
});
