import type { ComponentType } from 'react';

export interface StoryDef {
  id: string;
  title: string;
  category: string;
  component: ComponentType;
}

import { BoxBasicStory } from './BoxBasic';
import { BoxNestedStory } from './BoxNested';
import { TextStylesStory } from './TextStyles';
import { TextTruncationStory } from './TextTruncation';
import { ImageBasicStory } from './ImageBasic';
import { FlexRowStory } from './FlexRow';
import { FlexColumnStory } from './FlexColumn';
import { FlexWrapStory } from './FlexWrap';
import { PaddingMarginStory } from './PaddingMargin';
import { PressableStory } from './PressableStory';
import { SliderStory } from './SliderStory';
import { SwitchStory } from './SwitchStory';
import { ScrollViewStory } from './ScrollViewStory';
import { GradientStory } from './Gradient';
import { ShadowStory } from './Shadow';
import { TransformStory } from './Transform';
import { OpacityStory } from './Opacity';
import { ZIndexStory } from './ZIndex';
import { BorderRadiusStory } from './BorderRadius';
import { FlexShrinkStory } from './FlexShrink';
import { AspectRatioStory } from './AspectRatio';
import { TextDecorationStory } from './TextDecoration';
import { PerSideBorderStory } from './PerSideBorder';
import { CheckboxStory } from './CheckboxStory';
import { RadioStory } from './RadioStory';
import { SelectStory } from './SelectStory';
import { AnimationTimingStory } from './AnimationTiming';
import { AnimationSpringStory } from './AnimationSpring';
import { SettingsDemoStory } from './SettingsDemo';
import { ErrorTestStory } from './ErrorTest';

export const stories: StoryDef[] = [
  // Primitives
  { id: 'box-basic', title: 'Box', category: 'Primitives', component: BoxBasicStory },
  { id: 'box-nested', title: 'Nested Boxes', category: 'Primitives', component: BoxNestedStory },
  { id: 'text-styles', title: 'Text', category: 'Primitives', component: TextStylesStory },
  { id: 'text-truncation', title: 'Text Truncation', category: 'Primitives', component: TextTruncationStory },
  { id: 'image-basic', title: 'Image', category: 'Primitives', component: ImageBasicStory },

  // Layout
  { id: 'flex-row', title: 'Flex Row', category: 'Layout', component: FlexRowStory },
  { id: 'flex-column', title: 'Flex Column', category: 'Layout', component: FlexColumnStory },
  { id: 'flex-wrap', title: 'Flex Wrap', category: 'Layout', component: FlexWrapStory },
  { id: 'padding-margin', title: 'Padding & Margin', category: 'Layout', component: PaddingMarginStory },

  // Components
  { id: 'pressable', title: 'Pressable', category: 'Components', component: PressableStory },
  { id: 'slider', title: 'Slider', category: 'Components', component: SliderStory },
  { id: 'switch', title: 'Switch', category: 'Components', component: SwitchStory },
  { id: 'scrollview', title: 'ScrollView', category: 'Components', component: ScrollViewStory },

  // Visual
  { id: 'gradient', title: 'Gradients', category: 'Visual', component: GradientStory },
  { id: 'shadow', title: 'Box Shadow', category: 'Visual', component: ShadowStory },
  { id: 'transform', title: 'Transforms', category: 'Visual', component: TransformStory },
  { id: 'opacity', title: 'Opacity', category: 'Visual', component: OpacityStory },
  { id: 'zindex', title: 'Z-Index', category: 'Visual', component: ZIndexStory },
  { id: 'border-radius', title: 'Border Radius', category: 'Visual', component: BorderRadiusStory },

  // CSS Features
  { id: 'flex-shrink', title: 'Flex Shrink', category: 'CSS Features', component: FlexShrinkStory },
  { id: 'aspect-ratio', title: 'Aspect Ratio', category: 'CSS Features', component: AspectRatioStory },
  { id: 'text-decoration', title: 'Text Decoration', category: 'CSS Features', component: TextDecorationStory },
  { id: 'per-side-border', title: 'Per-Side Borders', category: 'CSS Features', component: PerSideBorderStory },

  // Forms
  { id: 'checkbox', title: 'Checkbox', category: 'Forms', component: CheckboxStory },
  { id: 'radio', title: 'Radio', category: 'Forms', component: RadioStory },
  { id: 'select', title: 'Select', category: 'Forms', component: SelectStory },

  // Animation
  { id: 'animation-timing', title: 'Spring Width', category: 'Animation', component: AnimationTimingStory },
  { id: 'animation-spring', title: 'Spring Position', category: 'Animation', component: AnimationSpringStory },

  // Demo
  { id: 'settings-demo', title: 'Settings Demo', category: 'Demo', component: SettingsDemoStory },

  // Dev Tools
  { id: 'error-test', title: 'Error Test', category: 'Dev Tools', component: ErrorTestStory },
];
