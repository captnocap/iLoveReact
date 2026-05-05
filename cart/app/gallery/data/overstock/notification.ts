import type { JsonObject } from '../../types';

export type NotificationKind = 'info' | 'success' | 'warning' | 'danger' | 'message';
export type NotificationApproach = 'inline' | 'corner' | 'overlay' | 'system';
export type NotificationLifetime = 'persistent' | 'self-dismiss';
export type NotificationActionKind = 'primary' | 'secondary' | 'dismiss' | 'remind' | 'reply';

export type NotificationAction = {
  id: string;
  label: string;
  kind: NotificationActionKind;
};

export type NotificationMessage = {
  id: string;
  kind: NotificationKind;
  approach: NotificationApproach;
  lifetime: NotificationLifetime;
  title: string;
  body: string;
  source: string;
  severity?: 'low' | 'medium' | 'high';
  durationMs?: number;
  actions: NotificationAction[];
  allowReply?: boolean;
  replyPlaceholder?: string;
};

export const notificationSchema: JsonObject = {
  type: 'object',
  fields: {
    id: { type: 'string' },
    kind: { enum: ['info', 'success', 'warning', 'danger', 'message'] },
    approach: { enum: ['inline', 'corner', 'overlay', 'system'] },
    lifetime: { enum: ['persistent', 'self-dismiss'] },
    title: { type: 'string' },
    body: { type: 'string' },
    source: { type: 'string' },
    severity: { enum: ['low', 'medium', 'high'] },
    durationMs: { type: 'number' },
    actions: {
      type: 'array',
      item: {
        type: 'object',
        fields: {
          id: { type: 'string' },
          label: { type: 'string' },
          kind: { enum: ['primary', 'secondary', 'dismiss', 'remind', 'reply'] },
        },
      },
    },
    allowReply: { type: 'boolean' },
    replyPlaceholder: { type: 'string' },
  },
};

export const notificationMockData: NotificationMessage[] = [
  {
    id: 'notif_constraint_blocked',
    kind: 'danger',
    approach: 'corner',
    lifetime: 'persistent',
    title: 'Action blocked by constraint',
    body: 'The resolver stopped a hard constraint violation before the action dispatcher ran.',
    source: 'EventHook.notify-user',
    severity: 'high',
    actions: [
      { id: 'inspect', label: 'Inspect', kind: 'primary' },
      { id: 'remind', label: 'Remind', kind: 'remind' },
      { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
    ],
  },
  {
    id: 'notif_budget_warn',
    kind: 'warning',
    approach: 'inline',
    lifetime: 'self-dismiss',
    title: 'Budget approaching daily cap',
    body: 'You have crossed the warning threshold for the active model budget.',
    source: 'Budget.threshold-warned',
    severity: 'medium',
    durationMs: 6000,
    actions: [
      { id: 'open-budget', label: 'Open budget', kind: 'primary' },
      { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
    ],
  },
  {
    id: 'notif_worker_reply',
    kind: 'message',
    approach: 'system',
    lifetime: 'persistent',
    title: 'Worker needs direction',
    body: 'The active worker is blocked on an ambiguous instruction and can accept a short reply.',
    source: 'Worker.lifecycle',
    severity: 'medium',
    allowReply: true,
    replyPlaceholder: 'Send direction without focusing the main app',
    actions: [
      { id: 'send', label: 'Send', kind: 'reply' },
      { id: 'open-thread', label: 'Open thread', kind: 'secondary' },
      { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
    ],
  },
  {
    id: 'notif_overlay_confirm',
    kind: 'info',
    approach: 'overlay',
    lifetime: 'persistent',
    title: 'Review before continuing',
    body: 'A larger call-to-action can interrupt the current surface without leaving the window.',
    source: 'Supervisor.attention',
    severity: 'high',
    actions: [
      { id: 'continue', label: 'Continue', kind: 'primary' },
      { id: 'later', label: 'Remind me', kind: 'remind' },
      { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
    ],
  },
];
