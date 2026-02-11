/**
 * Shared types for react-love primitives and style system.
 *
 * Colors can be CSS strings ("#ff0000", "rgba(...)") or
 * Love2D-style number arrays [r, g, b, a] where each is 0-1.
 */

export type Color = string | [number, number, number, number?];

export interface Style {
  // Sizing
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;

  // Sizing
  aspectRatio?: number;

  // Flexbox
  display?: 'flex' | 'none';
  flexDirection?: 'row' | 'column';
  flexWrap?: 'nowrap' | 'wrap';
  justifyContent?:
    | 'start'
    | 'center'
    | 'end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string | 'auto';
  gap?: number | string;

  // Spacing
  padding?: number | string;
  paddingLeft?: number | string;
  paddingRight?: number | string;
  paddingTop?: number | string;
  paddingBottom?: number | string;
  margin?: number | string;
  marginLeft?: number | string;
  marginRight?: number | string;
  marginTop?: number | string;
  marginBottom?: number | string;

  // Visual
  backgroundColor?: Color;
  borderRadius?: number;
  borderWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderColor?: Color;
  overflow?: 'visible' | 'hidden' | 'scroll';
  opacity?: number;
  zIndex?: number;
  scrollX?: number;
  scrollY?: number;

  // Box Shadow
  shadowColor?: Color;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;

  // Gradient
  backgroundGradient?: {
    direction: 'horizontal' | 'vertical' | 'diagonal';
    colors: [Color, Color];
  };

  // Transform
  transform?: {
    translateX?: number;
    translateY?: number;
    rotate?: number; // degrees
    scaleX?: number;
    scaleY?: number;
    originX?: number; // 0-1, default 0.5 (center)
    originY?: number; // 0-1, default 0.5 (center)
  };

  // Text
  color?: Color;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | number;
  textAlign?: 'left' | 'center' | 'right';
  textOverflow?: 'clip' | 'ellipsis';
  textDecorationLine?: 'none' | 'underline' | 'line-through';
  lineHeight?: number;
  letterSpacing?: number;

  // Image
  objectFit?: 'fill' | 'contain' | 'cover' | 'none';

  // Positioning (absolute overlays)
  position?: 'relative' | 'absolute';
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
}

export interface LoveEvent {
  type: string;
  targetId?: number;
  x?: number;
  y?: number;
  button?: number;
  key?: string;
  scancode?: string;
  isRepeat?: boolean;
  text?: string;
  // Wheel events
  deltaX?: number;
  deltaY?: number;
  // Touch events
  touchId?: number | string;
  dx?: number;
  dy?: number;
  pressure?: number;
  // Gamepad events
  gamepadButton?: string;
  axis?: string;
  axisValue?: number;
  joystickId?: number;
  // Drag events
  startX?: number;
  startY?: number;
  totalDeltaX?: number;
  totalDeltaY?: number;

  // Bubbling support
  bubblePath?: number[];
  currentTarget?: number;
  stopPropagation?: () => void;
}

export interface BoxProps {
  style?: Style;
  onClick?: (event: LoveEvent) => void;
  onRelease?: (event: LoveEvent) => void;
  onPointerEnter?: (event: LoveEvent) => void;
  onPointerLeave?: (event: LoveEvent) => void;
  onKeyDown?: (event: LoveEvent) => void;
  onKeyUp?: (event: LoveEvent) => void;
  onTextInput?: (event: LoveEvent) => void;
  onWheel?: (event: LoveEvent) => void;
  onTouchStart?: (event: LoveEvent) => void;
  onTouchEnd?: (event: LoveEvent) => void;
  onTouchMove?: (event: LoveEvent) => void;
  onGamepadPress?: (event: LoveEvent) => void;
  onGamepadRelease?: (event: LoveEvent) => void;
  onGamepadAxis?: (event: LoveEvent) => void;
  onDragStart?: (event: LoveEvent) => void;
  onDrag?: (event: LoveEvent) => void;
  onDragEnd?: (event: LoveEvent) => void;
  children?: React.ReactNode;
  key?: string | number;
}

export interface TextProps {
  style?: Style;
  numberOfLines?: number;
  onKeyDown?: (event: LoveEvent) => void;
  onKeyUp?: (event: LoveEvent) => void;
  onTextInput?: (event: LoveEvent) => void;
  children?: React.ReactNode;
  key?: string | number;
}

export interface ImageProps {
  src: string;
  style?: Style;
  onClick?: (event: LoveEvent) => void;
  onWheel?: (event: LoveEvent) => void;
  key?: string | number;
}

export interface ScrollEvent {
  scrollX: number;
  scrollY: number;
  contentWidth: number;
  contentHeight: number;
}

export interface ScrollViewProps {
  style?: Style;
  horizontal?: boolean;
  showScrollIndicator?: boolean;
  onScroll?: (event: ScrollEvent) => void;
  onScrollBegin?: () => void;
  onScrollEnd?: () => void;
  children?: React.ReactNode;
  key?: string | number;
}

export interface ScrollViewRef {
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void;
}

export interface TextInputProps {
  value?: string;
  defaultValue?: string;
  onChangeText?: (text: string) => void;
  onSubmit?: (text: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  placeholderColor?: Color;
  maxLength?: number;
  multiline?: boolean;
  editable?: boolean;
  secureTextEntry?: boolean;
  style?: Style;
  textStyle?: Style;
  autoFocus?: boolean;
  cursorColor?: Color;
  key?: string | number;
}

export interface FlatListProps<T> {
  data: T[];
  renderItem: (info: { item: T; index: number }) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  horizontal?: boolean;

  // Item sizing (required for virtualization)
  itemHeight?: number;
  itemWidth?: number;
  estimatedItemSize?: number;

  // Callbacks
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onScroll?: (event: ScrollEvent) => void;

  // Headers/footers
  ListHeaderComponent?: React.ReactNode;
  ListFooterComponent?: React.ReactNode;
  ListEmptyComponent?: React.ReactNode;

  // Separators
  ItemSeparatorComponent?: React.ReactNode;

  // Styling
  style?: Style;
  contentContainerStyle?: Style;

  // Performance
  initialNumToRender?: number;
  windowSize?: number;
  maxToRenderPerBatch?: number;

  // Misc
  inverted?: boolean;
  numColumns?: number;

  key?: string | number;
}

export interface FlatListRef {
  scrollToIndex(params: { index: number; animated?: boolean }): void;
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}
