import { useEffect, useState } from 'react';
import { Box, Col, Notification as HostNotification, Pressable, Row, Text, TextInput } from '@reactjit/runtime/primitives';
import { AlertTriangle, BellRing, CheckCircle, CircleAlert, Clock, Info, MessageSquareText, Monitor, Pin, Send, X } from '@reactjit/runtime/icons/icons';
import { Icon, type IconData } from '@reactjit/runtime/icons/Icon';
import { Body, Divider, Mono } from '../controls-specimen/controlsSpecimenParts';
import { CTRL, type ControlTone, toneColor, toneSoftBackground } from '../controls-specimen/controlsSpecimenTheme';
import { StatusBadge } from '../controls-specimen/StatusBadge';
import type { NotificationAction, NotificationApproach, NotificationKind, NotificationLifetime, NotificationMessage } from '../../data/overstock/notification';

export type NotificationType = NotificationApproach;
export type NotificationMethod = NotificationKind;

export type NotificationData = Partial<NotificationMessage> & {
  actions?: NotificationAction[];
};

export type NotificationProps = {
  type?: NotificationType;
  method?: NotificationMethod;
  data?: NotificationData;
  onAction?: (id: string, payload?: { reply?: string }) => void;
  onDismiss?: () => void;
  onRemind?: () => void;
  onReply?: (message: string) => void;
};

const DEFAULT_ACTIONS: NotificationAction[] = [
  { id: 'open', label: 'Open', kind: 'primary' },
  { id: 'remind', label: 'Remind', kind: 'remind' },
  { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
];

const DEFAULT_DATA: Required<Pick<NotificationMessage, 'id' | 'kind' | 'approach' | 'lifetime' | 'title' | 'body' | 'source' | 'actions'>> = {
  id: 'notification_default',
  kind: 'info',
  approach: 'inline',
  lifetime: 'persistent',
  title: 'Notification',
  body: 'A notification surface can render inline, in a fixed corner, as an overlay call-to-action, or through the native Notification primitive.',
  source: 'Notification.surface',
  actions: DEFAULT_ACTIONS,
};

function toneForKind(kind: NotificationKind): ControlTone {
  switch (kind) {
    case 'success':
      return 'ok';
    case 'warning':
      return 'warn';
    case 'danger':
      return 'flag';
    case 'message':
      return 'blue';
    default:
      return 'accent';
  }
}

function iconForKind(kind: NotificationKind): IconData {
  switch (kind) {
    case 'success':
      return CheckCircle;
    case 'warning':
      return AlertTriangle;
    case 'danger':
      return CircleAlert;
    case 'message':
      return MessageSquareText;
    default:
      return Info;
  }
}

function titleForApproach(type: NotificationType): string {
  switch (type) {
    case 'corner':
      return 'Fixed corner';
    case 'overlay':
      return 'Overlay CTA';
    case 'system':
      return 'System notification';
    default:
      return 'Inline';
  }
}

function actionTone(kind: NotificationAction['kind'], fallback: ControlTone): ControlTone {
  switch (kind) {
    case 'dismiss':
      return 'neutral';
    case 'remind':
      return 'warn';
    case 'reply':
      return 'blue';
    case 'primary':
      return fallback;
    default:
      return 'accent';
  }
}

function ActionButton({
  action,
  tone,
  onPress,
}: {
  action: NotificationAction;
  tone: ControlTone;
  onPress: () => void;
}) {
  const color = toneColor(tone);
  const solid = action.kind === 'primary' || action.kind === 'reply';
  return (
    <Pressable onPress={onPress}>
      <Row
        style={{
          gap: 6,
          alignItems: 'center',
          paddingLeft: 9,
          paddingRight: 9,
          paddingTop: 5,
          paddingBottom: 5,
          borderWidth: 1,
          borderColor: color,
          backgroundColor: solid ? color : toneSoftBackground(tone),
        }}
      >
        {action.kind === 'dismiss' ? <Icon icon={X} size={12} color={solid ? CTRL.bg : color} /> : null}
        {action.kind === 'remind' ? <Icon icon={Clock} size={12} color={solid ? CTRL.bg : color} /> : null}
        {action.kind === 'reply' ? <Icon icon={Send} size={12} color={solid ? CTRL.bg : color} /> : null}
        <Mono color={solid ? CTRL.bg : color} fontSize={9} fontWeight="bold" lineHeight={10} noWrap>
          {action.label}
        </Mono>
      </Row>
    </Pressable>
  );
}

function NotificationSurface({
  type,
  method,
  data,
  onAction,
  onDismiss,
  onRemind,
  onReply,
}: {
  type: NotificationType;
  method: NotificationMethod;
  data: NotificationData;
  onAction?: NotificationProps['onAction'];
  onDismiss?: NotificationProps['onDismiss'];
  onRemind?: NotificationProps['onRemind'];
  onReply?: NotificationProps['onReply'];
}) {
  const tone = toneForKind(method);
  const color = toneColor(tone);
  const [reply, setReply] = useState('');
  const actions = data.actions && data.actions.length ? data.actions : DEFAULT_ACTIONS;
  const overlay = type === 'overlay';

  const fire = (action: NotificationAction) => {
    if (action.kind === 'dismiss') onDismiss?.();
    if (action.kind === 'remind') onRemind?.();
    if (action.kind === 'reply') onReply?.(reply);
    onAction?.(action.id, action.kind === 'reply' ? { reply } : undefined);
  };

  return (
    <Col
      style={{
        width: overlay ? 520 : 380,
        gap: overlay ? 14 : 10,
        padding: overlay ? 18 : 12,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: CTRL.bg2,
        shadowBlur: overlay ? 18 : 8,
        shadowColor: 'theme:bg',
      }}
    >
      <Row style={{ width: '100%', gap: 11, alignItems: 'flex-start' }}>
        <Box
          style={{
            width: overlay ? 38 : 30,
            height: overlay ? 38 : 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: color,
            backgroundColor: toneSoftBackground(tone),
          }}
        >
          <Icon icon={iconForKind(method)} size={overlay ? 21 : 17} color={color} strokeWidth={2.1} />
        </Box>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 4 }}>
          <Row style={{ gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge label={method} tone={tone} variant="led" />
            <StatusBadge label={titleForApproach(type)} tone="neutral" variant="outline" />
            <StatusBadge label={data.lifetime || DEFAULT_DATA.lifetime} tone={data.lifetime === 'self-dismiss' ? 'warn' : 'accent'} variant="outline" />
          </Row>
          <Body fontSize={overlay ? 18 : 14} lineHeight={overlay ? 22 : 17} fontWeight="bold">
            {data.title || DEFAULT_DATA.title}
          </Body>
          <Body fontSize={overlay ? 13 : 12} lineHeight={overlay ? 18 : 16} color={CTRL.inkDim}>
            {data.body || DEFAULT_DATA.body}
          </Body>
        </Col>
        <Pressable onPress={() => fire({ id: 'dismiss', label: 'Dismiss', kind: 'dismiss' })}>
          <Box style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
            <Icon icon={X} size={15} color={CTRL.inkDim} />
          </Box>
        </Pressable>
      </Row>

      <Divider />

      <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon icon={type === 'system' ? Monitor : type === 'corner' ? Pin : BellRing} size={14} color={color} />
        <Mono fontSize={9} letterSpacing={0.4} lineHeight={10} noWrap>
          {data.source || DEFAULT_DATA.source}
        </Mono>
      </Row>

      {data.allowReply ? (
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, borderWidth: 1, borderColor: CTRL.ruleBright, backgroundColor: CTRL.bg1 }}>
            <TextInput
              value={reply}
              onChange={setReply}
              placeholder={data.replyPlaceholder || 'Send a message'}
              style={{ width: '100%', paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, color: CTRL.ink, fontSize: 11 }}
            />
          </Box>
          <ActionButton
            action={{ id: 'send', label: 'Send', kind: 'reply' }}
            tone="blue"
            onPress={() => fire({ id: 'send', label: 'Send', kind: 'reply' })}
          />
        </Row>
      ) : null}

      <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {actions.map((action) => (
          <ActionButton key={action.id} action={action} tone={actionTone(action.kind, tone)} onPress={() => fire(action)} />
        ))}
      </Row>
    </Col>
  );
}

function InlineNotification(props: Omit<Parameters<typeof NotificationSurface>[0], 'type'> & { type: NotificationType }) {
  return <NotificationSurface {...props} />;
}

function CornerNotification(props: Omit<Parameters<typeof NotificationSurface>[0], 'type'> & { type: NotificationType }) {
  return (
    <Box style={{ position: 'relative', width: 460, height: 220 }}>
      <Box style={{ position: 'absolute', right: 0, bottom: 0 }}>
        <NotificationSurface {...props} />
      </Box>
    </Box>
  );
}

function OverlayNotification(props: Omit<Parameters<typeof NotificationSurface>[0], 'type'> & { type: NotificationType }) {
  return (
    <Box
      style={{
        position: 'relative',
        width: 640,
        height: 320,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'theme:bg',
      }}
    >
      <Box style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'theme:bg', opacity: 0.36 }} />
      <NotificationSurface {...props} />
    </Box>
  );
}

function SystemNotification(props: Omit<Parameters<typeof NotificationSurface>[0], 'type'> & { type: NotificationType }) {
  const duration = props.data.lifetime === 'self-dismiss' ? Math.max(1, (props.data.durationMs || 5000) / 1000) : 0;
  return (
    <HostNotification
      title={props.data.title || DEFAULT_DATA.title}
      width={410}
      height={props.data.allowReply ? 236 : 184}
      duration={duration}
      alwaysOnTop
      borderless
      onDismiss={props.onDismiss}
    >
      <NotificationSurface {...props} />
    </HostNotification>
  );
}

export function Notification({
  type,
  method,
  data = {},
  onAction,
  onDismiss,
  onRemind,
  onReply,
}: NotificationProps) {
  const resolvedType = type || data.approach || DEFAULT_DATA.approach;
  const resolvedMethod = method || data.kind || DEFAULT_DATA.kind;
  const [visible, setVisible] = useState(true);
  const lifetime: NotificationLifetime = data.lifetime || DEFAULT_DATA.lifetime;

  useEffect(() => {
    if (lifetime !== 'self-dismiss') return;
    const id = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, data.durationMs || 5000);
    return () => clearTimeout(id);
  }, [data.durationMs, lifetime, onDismiss]);

  const dismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  if (!visible) return null;

  const surfaceProps = {
    type: resolvedType,
    method: resolvedMethod,
    data: { ...data, approach: resolvedType, kind: resolvedMethod, lifetime },
    onAction,
    onDismiss: dismiss,
    onRemind,
    onReply,
  };

  if (resolvedType === 'corner') return <CornerNotification {...surfaceProps} />;
  if (resolvedType === 'overlay') return <OverlayNotification {...surfaceProps} />;
  if (resolvedType === 'system') return <SystemNotification {...surfaceProps} />;
  return <InlineNotification {...surfaceProps} />;
}
