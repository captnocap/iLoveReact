import { Box, Col, Pressable, Row } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { Body, Divider, Mono } from '../controls-specimen/controlsSpecimenParts';
import { CTRL, type ControlTone, toneColor, toneSoftBackground } from '../controls-specimen/controlsSpecimenTheme';
import type { ToolbarMenuItem } from '../../data/overstock/toolbar';

type MenuAction = (id: string) => void;

function itemTone(item: ToolbarMenuItem): ControlTone {
  return item.tone || 'neutral';
}

export function ToolbarMenuDivider() {
  return <Divider color={CTRL.rule} />;
}

export function ToolbarMenuItemRow({
  item,
  depth = 0,
  openIds = [],
  onAction,
}: {
  item: ToolbarMenuItem;
  depth?: number;
  openIds?: string[];
  onAction?: MenuAction;
}) {
  const tone = itemTone(item);
  const color = toneColor(tone);
  const hasChildren = !!item.children?.length;
  const open = hasChildren && openIds.includes(item.id);
  const disabled = item.disabled === true;

  return (
    <Col style={{ gap: 4 }}>
      <Pressable disabled={disabled} onPress={() => onAction?.(item.id)}>
        <Row
          style={{
            minHeight: 32,
            gap: 8,
            alignItems: 'center',
            paddingLeft: 8 + depth * 12,
            paddingRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
            borderWidth: 1,
            borderColor: open ? color : CTRL.rule,
            backgroundColor: open ? toneSoftBackground(tone) : CTRL.bg1,
            opacity: disabled ? 0.42 : 1,
          }}
        >
          <Box style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
            {item.icon ? <Icon name={item.icon} size={14} color={color} /> : null}
          </Box>
          <Body
            noWrap
            lineHeight={16}
            fontSize={11}
            color={disabled ? CTRL.inkGhost : CTRL.ink}
            style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}
          >
            {item.label}
          </Body>
          {item.shortcut ? (
            <Mono color={CTRL.inkDimmer} fontSize={8} lineHeight={16} noWrap>
              {item.shortcut}
            </Mono>
          ) : null}
          {hasChildren ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} color={color} /> : null}
        </Row>
      </Pressable>

      {open && item.children ? (
        <Col style={{ gap: 4, paddingLeft: depth === 0 ? 12 : 10 }}>
          {item.children.map((child) => (
            <ToolbarMenuItemRow key={child.id} item={child} depth={depth + 1} openIds={openIds} onAction={onAction} />
          ))}
        </Col>
      ) : null}
    </Col>
  );
}

export function ToolbarMenu({
  items,
  openIds = [],
  onAction,
  width = 250,
}: {
  items: ToolbarMenuItem[];
  openIds?: string[];
  onAction?: MenuAction;
  width?: number;
}) {
  return (
    <Col
      style={{
        width,
        gap: 5,
        padding: 8,
        borderWidth: 1,
        borderColor: CTRL.ruleBright,
        backgroundColor: CTRL.bg2,
        shadowBlur: 8,
        shadowColor: 'theme:bg',
      }}
    >
      {items.map((item, index) => (
        <Col key={item.id} style={{ gap: 5 }}>
          <ToolbarMenuItemRow item={item} openIds={openIds} onAction={onAction} />
          {index === 1 && items.length > 3 ? <ToolbarMenuDivider /> : null}
        </Col>
      ))}
    </Col>
  );
}
