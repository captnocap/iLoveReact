import { Box } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';

export type BrowserIconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'refresh'
  | 'home'
  | 'bookmark'
  | 'go'
  | 'sliders'
  | 'minus'
  | 'square'
  | 'x'
  | 'page'
  | 'blank';

const ICON_PATHS: Record<BrowserIconName, string> = {
  'chevron-left': 'M15 18L9 12L15 6',
  'chevron-right': 'M9 18L15 12L9 6',
  'refresh': 'M20 5V10H15 M4 19V14H9 M6.8 9A7 7 0 0 1 18 7 M17.2 15A7 7 0 0 1 6 17',
  'home': 'M4 11L12 4L20 11 M7 9.5V20H17V9.5',
  'bookmark': 'M6 4H18V20L12 16L6 20Z',
  'go': 'M5 12H19 M12 5L19 12L12 19',
  'sliders': 'M4 6H9 M15 6H20 M12 4V8 M4 12H15 M19 10V14 M4 18H7 M13 18H20 M10 16V20',
  'minus': 'M5 12H19',
  'square': 'M6 6H18V18H6Z',
  'x': 'M6 6L18 18 M18 6L6 18',
  'page': 'M7 4H17V20H7Z M10 9H14 M10 13H14',
  'blank': 'M6 6H18V18H6Z',
};

export default function BrowserIcon({
  name,
  size = 14,
  color = COLORS.text,
  strokeWidth = 1.8,
  onPress,
}: {
  name: BrowserIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  onPress?: () => void;
}) {
  return (
    <Box
      d={ICON_PATHS[name]}
      stroke={color}
      strokeWidth={strokeWidth}
      onClick={onPress}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
      }}
    />
  );
}
