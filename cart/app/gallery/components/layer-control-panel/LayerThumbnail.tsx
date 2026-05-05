import { Box } from '@reactjit/runtime/primitives';
import {
  Circle,
  FolderOpen,
  Image as ImageIcon,
  SlidersHorizontal,
  Sparkles,
  Type,
} from '@reactjit/runtime/icons/icons';
import { Icon } from '@reactjit/runtime/icons/Icon';
import type { LayerControlLayer, LayerKind } from '../../data/overstock/layer-control-panel';
import { Body, Mono } from '../controls-specimen/controlsSpecimenParts';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';

export type LayerThumbnailProps = {
  layer: LayerControlLayer;
  size?: 'compact' | 'large';
};

const kindIcon: Record<LayerKind, number[][]> = {
  pixel: ImageIcon,
  group: FolderOpen,
  adjustment: SlidersHorizontal,
  type: Type,
  mask: Circle,
  smart: Sparkles,
};

export function LayerThumbnail({ layer, size = 'compact' }: LayerThumbnailProps) {
  const width = size === 'large' ? 74 : 44;
  const height = size === 'large' ? 56 : 34;
  const iconSize = size === 'large' ? 20 : 14;

  return (
    <Box
      style={{
        width,
        height,
        flexShrink: 0,
        borderWidth: 1,
        borderColor: layer.visible ? layer.color : CTRL.rule,
        backgroundColor: layer.visible ? CTRL.bg2 : CTRL.bg1,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          opacity: layer.visible ? 1 : 0.45,
        }}
      >
        <Box style={{ width: '50%', height: '50%', backgroundColor: CTRL.bg1 }} />
        <Box style={{ position: 'absolute', right: 0, top: 0, width: '50%', height: '50%', backgroundColor: CTRL.bg3 }} />
        <Box style={{ position: 'absolute', left: 0, bottom: 0, width: '50%', height: '50%', backgroundColor: CTRL.bg3 }} />
        <Box style={{ position: 'absolute', right: 0, bottom: 0, width: '50%', height: '50%', backgroundColor: CTRL.bg1 }} />
      </Box>
      <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <Icon icon={kindIcon[layer.kind]} size={iconSize} color={layer.color} strokeWidth={2.1} />
        {size === 'large' ? (
          <Body color={CTRL.ink} fontSize={11} lineHeight={13} fontWeight="bold" noWrap>
            {layer.thumbnail}
          </Body>
        ) : (
          <Mono color={CTRL.inkDim} fontSize={7} lineHeight={8} noWrap>
            {layer.thumbnail}
          </Mono>
        )}
      </Box>
    </Box>
  );
}
