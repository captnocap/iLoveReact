// Types
export type {
  Style,
  Color,
  LoveEvent,
  BoxProps,
  TextProps,
  ImageProps,
  ScrollEvent,
  ScrollViewProps,
  ScrollViewRef,
  TextInputProps,
  TextEditorProps,
  FlatListProps,
  FlatListRef,
} from './types';

// Bridge interface
export type { IBridge, BridgeEvent, Listener, Unsubscribe } from './bridge';

// Context & providers
export {
  BridgeProvider,
  useBridge,
  RendererProvider,
  useRendererMode,
  type RendererMode,
} from './context';

// Hooks
export {
  useLove,
  useLoveEvent,
  useLoveRPC,
  useLoveState,
  useLoveReady,
  useLoveSend,
  useLoveOverlays,
  type Overlay,
} from './hooks';

// Primitives
export { Box, Row, Col, Text, Image, styleToCSS, colorToCSS } from './primitives';

// ScrollView
export { ScrollView } from './ScrollView';

// Portal system
export { Portal, PortalHost, type PortalProps, type PortalHostProps } from './Portal';

// Components
export { Pressable, type PressableProps, type PressableState, type HitSlop } from './Pressable';
export { Modal, type ModalProps } from './Modal';

// TextInput
export { TextInput } from './TextInput';

// TextEditor (Lua-owned document editor)
export { TextEditor } from './TextEditor';

// FlatList
export { FlatList } from './FlatList';

// Slider
export { Slider, type SliderProps } from './Slider';

// Switch
export { Switch, type SwitchProps } from './Switch';

// Form primitives
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Radio, RadioGroup, type RadioProps, type RadioGroupProps } from './Radio';
export { Select, type SelectProps, type SelectOption } from './Select';

// Layout
export { FlexRow, type FlexRowProps } from './FlexRow';
export { FlexColumn, type FlexColumnProps } from './FlexColumn';
export { Spacer, type SpacerProps } from './Spacer';

// Card
export { Card, type CardProps } from './Card';

// Badge
export { Badge, type BadgeProps, type BadgeVariant } from './Badge';

// Divider
export { Divider, type DividerProps } from './Divider';

// Navigation
export { NavPanel, type NavPanelProps, type NavItem, type NavSection } from './NavPanel';
export { Tabs, type TabsProps, type Tab } from './Tabs';
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from './Breadcrumbs';
export { Toolbar, type ToolbarProps, type ToolbarEntry } from './Toolbar';

// Data visualization
export { Table, type TableProps, type TableColumn } from './Table';
export { BarChart, type BarChartProps, type BarChartBar } from './BarChart';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { Sparkline, type SparklineProps } from './Sparkline';

// Animation
export {
  AnimatedValue,
  useAnimation,
  useSpring,
  useTransition,
  Easing,
  parallel,
  sequence,
  stagger,
  loop,
  type Animation,
  type EasingFunction,
  type TimingConfig,
  type SpringConfig,
  type InterpolationConfig,
} from './animation';

// Colors
export { colors, type CatppuccinColor } from './colors';

// Debug tools
export { useDebug, getDebugData, registerDebug } from './useDebug';
export { DebugOverlay, DebugBox, useDebugOverlay } from './DebugOverlay';
