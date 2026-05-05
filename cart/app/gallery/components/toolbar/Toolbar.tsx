import { useState } from 'react';
import { Box, Col, Pressable, Row } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { Body, InlinePill, Mono, VerticalSpine } from '../controls-specimen/controlsSpecimenParts';
import { CTRL, type ControlTone, toneColor, toneSoftBackground } from '../controls-specimen/controlsSpecimenTheme';
import { StatusBadge } from '../controls-specimen/StatusBadge';
import type { ToolbarData, ToolbarItem, ToolbarKind, ToolbarOrientation } from '../../data/overstock/toolbar';
import { toolbarIconData, toolbarStatusData, toolbarTextMenuData, toolbarVerticalData } from '../../data/overstock/toolbar';
import { ToolbarMenu } from './ToolbarMenu';

export type ToolbarType = ToolbarKind;
type OpenIdSetter = (next: string[] | ((previous: string[]) => string[])) => void;

export type ToolbarProps = {
  type?: ToolbarType;
  data?: ToolbarData;
  orientation?: ToolbarOrientation;
  onAction?: (id: string) => void;
};

function defaultDataForType(type: ToolbarType): ToolbarData {
  switch (type) {
    case 'icon-bar':
      return toolbarIconData;
    case 'status':
      return toolbarStatusData;
    case 'vertical':
      return toolbarVerticalData;
    case 'text-menu':
    default:
      return toolbarTextMenuData;
  }
}

function colorForItem(item: Pick<ToolbarItem, 'tone' | 'active' | 'disabled'>): string {
  if (item.disabled) return CTRL.inkGhost;
  return toneColor(item.tone || (item.active ? 'accent' : 'neutral'));
}

export function ToolbarSeparator({ orientation = 'horizontal' }: { orientation?: ToolbarOrientation }) {
  return (
    <Box
      style={{
        width: orientation === 'vertical' ? 26 : 1,
        height: orientation === 'vertical' ? 1 : 26,
        backgroundColor: CTRL.rule,
      }}
    />
  );
}

export function ToolbarButton({
  item,
  active,
  compact = false,
  onPress,
}: {
  item: ToolbarItem;
  active?: boolean;
  compact?: boolean;
  onPress?: () => void;
}) {
  const tone: ControlTone = item.tone || (active || item.active ? 'accent' : 'neutral');
  const color = colorForItem({ ...item, tone });
  const isActive = active || item.active;

  return (
    <Pressable disabled={item.disabled} onPress={onPress}>
      <Row
        style={{
          height: compact ? 30 : 32,
          gap: 7,
          alignItems: 'center',
          paddingLeft: compact ? 8 : 10,
          paddingRight: compact ? 8 : 10,
          borderWidth: 1,
          borderColor: isActive ? color : CTRL.rule,
          backgroundColor: isActive ? toneSoftBackground(tone) : CTRL.bg1,
          opacity: item.disabled ? 0.45 : 1,
        }}
      >
        {item.icon ? <Icon name={item.icon} size={14} color={color} /> : null}
        <Body color={item.disabled ? CTRL.inkGhost : CTRL.ink} fontSize={12} lineHeight={14} noWrap>
          {item.label || item.id}
        </Body>
        {item.kind === 'menu' ? <Icon name={isActive ? 'chevron-down' : 'chevron-right'} size={13} color={color} /> : null}
      </Row>
    </Pressable>
  );
}

export function ToolbarIconButton({
  item,
  active,
  onPress,
}: {
  item: ToolbarItem;
  active?: boolean;
  onPress?: () => void;
}) {
  const tone: ControlTone = item.tone || (active || item.active ? 'accent' : 'neutral');
  const color = colorForItem({ ...item, tone });
  const isActive = active || item.active;

  return (
    <Pressable disabled={item.disabled} onPress={onPress}>
      <Box
        style={{
          width: 32,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: isActive ? color : CTRL.rule,
          backgroundColor: isActive ? toneSoftBackground(tone) : CTRL.bg1,
          opacity: item.disabled ? 0.42 : 1,
        }}
      >
        {item.icon ? <Icon name={item.icon} size={16} color={color} /> : null}
      </Box>
    </Pressable>
  );
}

export function ToolbarStatusItem({ item }: { item: ToolbarItem }) {
  const tone: ControlTone = item.tone || 'neutral';
  const color = toneColor(tone);

  return (
    <Row
      style={{
        minHeight: 32,
        gap: 8,
        alignItems: 'center',
        paddingLeft: 9,
        paddingRight: 9,
        borderWidth: 1,
        borderColor: CTRL.rule,
        backgroundColor: CTRL.bg1,
      }}
    >
      {item.icon ? <Icon name={item.icon} size={14} color={color} /> : null}
      <Col style={{ gap: 1 }}>
        <Mono color={CTRL.inkDimmer} fontSize={7} lineHeight={8} letterSpacing={1.1} noWrap>
          {item.label || item.id}
        </Mono>
        <Mono color={color} fontSize={9} lineHeight={10} fontWeight="bold" letterSpacing={1.2} noWrap>
          {item.value || 'ready'}
        </Mono>
      </Col>
    </Row>
  );
}

function TextMenuToolbar({
  data,
  openIds,
  setOpenIds,
  onAction,
}: {
  data: ToolbarData;
  openIds: string[];
  setOpenIds: OpenIdSetter;
  onAction?: (id: string) => void;
}) {
  const collectMenuIds = (items: NonNullable<ToolbarItem['menu']>): string[] => {
    const ids: string[] = [];
    items.forEach((item) => {
      ids.push(item.id);
      if (item.children?.length) ids.push(...collectMenuIds(item.children));
    });
    return ids;
  };

  const toggleTop = (id: string) => {
    const item = data.items.find((entry) => entry.id === id);
    const descendantIds = item?.menu ? collectMenuIds(item.menu) : [];
    const defaultNested = (data.openMenuIds || []).filter((openId) => descendantIds.includes(openId));
    setOpenIds((previous) => (previous.includes(id) ? [] : [id, ...defaultNested]));
    onAction?.(id);
  };

  const toggleMenu = (id: string) => {
    setOpenIds((previous) => (previous.includes(id) ? previous.filter((openId) => openId !== id) : [...previous, id]));
    onAction?.(id);
  };

  return (
    <Col style={{ gap: 8 }}>
      <Row
        style={{
          gap: 6,
          alignItems: 'flex-start',
          padding: 6,
          borderWidth: 1,
          borderColor: CTRL.ruleBright,
          backgroundColor: CTRL.bg2,
        }}
      >
        {data.items.map((item) => {
          if (item.kind === 'separator') return <ToolbarSeparator key={item.id} />;
          const open = openIds.includes(item.id);
          return (
            <Col key={item.id} style={{ gap: 6 }}>
              <ToolbarButton item={item} active={open} onPress={() => toggleTop(item.id)} />
              {item.kind === 'menu' && item.menu && open ? (
                <ToolbarMenu items={item.menu} openIds={openIds} onAction={toggleMenu} />
              ) : null}
            </Col>
          );
        })}
      </Row>
    </Col>
  );
}

function IconToolbar({
  data,
  orientation = 'horizontal',
  openIds,
  setOpenIds,
  onAction,
}: {
  data: ToolbarData;
  orientation?: ToolbarOrientation;
  openIds: string[];
  setOpenIds: OpenIdSetter;
  onAction?: (id: string) => void;
}) {
  const Frame = orientation === 'vertical' ? Col : Row;
  const menuItem = data.items.find((item) => item.kind === 'menu' && openIds.includes(item.id));

  const toggle = (id: string) => {
    setOpenIds((previous) => (previous.includes(id) ? previous.filter((openId) => openId !== id) : [...previous, id]));
    onAction?.(id);
  };

  const toolbar = (
    <Frame
      style={{
        gap: 6,
        alignItems: 'center',
        padding: 6,
        borderWidth: 1,
        borderColor: CTRL.ruleBright,
        backgroundColor: CTRL.bg2,
      }}
    >
      {data.items.map((item) => {
        if (item.kind === 'separator') return <ToolbarSeparator key={item.id} orientation={orientation} />;
        if (item.kind === 'menu') {
          return (
            <ToolbarIconButton
              key={item.id}
              item={item}
              active={openIds.includes(item.id)}
              onPress={() => toggle(item.id)}
            />
          );
        }
        return <ToolbarIconButton key={item.id} item={item} onPress={() => onAction?.(item.id)} />;
      })}
    </Frame>
  );

  if (orientation !== 'vertical') return toolbar;

  return (
    <Row style={{ gap: 10, alignItems: 'flex-start' }}>
      {toolbar}
      {menuItem?.menu ? <ToolbarMenu items={menuItem.menu} openIds={openIds} onAction={toggle} width={258} /> : null}
    </Row>
  );
}

function StatusToolbar({ data }: { data: ToolbarData }) {
  return (
    <Row
      style={{
        gap: 6,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: 6,
        borderWidth: 1,
        borderColor: CTRL.ruleBright,
        backgroundColor: CTRL.bg2,
      }}
    >
      {data.items.map((item) => (
        <ToolbarStatusItem key={item.id} item={item} />
      ))}
    </Row>
  );
}

export function Toolbar({
  type,
  data,
  orientation,
  onAction,
}: ToolbarProps) {
  const resolvedType = type || data?.kind || 'text-menu';
  const resolved = data || defaultDataForType(resolvedType);
  const resolvedOrientation = orientation || resolved.orientation || 'horizontal';
  const [openIds, setOpenIds] = useState<string[]>(resolved.openMenuIds || []);

  return (
    <Col style={{ gap: 9, alignItems: 'flex-start' }}>
      <Row style={{ gap: 8, alignItems: 'center' }}>
        {resolvedOrientation === 'vertical' ? (
          <VerticalSpine label="TOOLBAR" tone="accent" minWidth={26} />
        ) : (
          <InlinePill label="TOOLBAR" tone="accent" />
        )}
        <StatusBadge label={resolved.kind} tone={resolved.kind === 'status' ? 'ok' : 'blue'} variant="outline" />
        <Mono color={CTRL.inkDimmer} lineHeight={10} noWrap>
          {resolved.label}
        </Mono>
      </Row>

      {resolvedType === 'status' ? (
        <StatusToolbar data={resolved} />
      ) : resolvedType === 'icon-bar' ? (
        <IconToolbar
          data={resolved}
          orientation="horizontal"
          openIds={openIds}
          setOpenIds={setOpenIds}
          onAction={onAction}
        />
      ) : resolvedType === 'vertical' ? (
        <IconToolbar
          data={resolved}
          orientation={resolvedOrientation}
          openIds={openIds}
          setOpenIds={setOpenIds}
          onAction={onAction}
        />
      ) : (
        <TextMenuToolbar data={resolved} openIds={openIds} setOpenIds={setOpenIds} onAction={onAction} />
      )}
    </Col>
  );
}

export { ToolbarMenu, ToolbarMenuItemRow, ToolbarMenuDivider } from './ToolbarMenu';
