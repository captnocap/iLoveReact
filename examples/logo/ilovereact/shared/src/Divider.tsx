import React from 'react';
import { Box } from './primitives';
import type { Style } from './types';

export interface DividerProps {
  direction?: 'horizontal' | 'vertical';
  color?: string;
  thickness?: number;
  style?: Style;
}

export function Divider({
  direction = 'horizontal',
  color = '#334155',
  thickness = 1,
  style,
}: DividerProps) {
  return (
    <Box style={{
      backgroundColor: color,
      ...(direction === 'horizontal'
        ? { height: thickness, width: '100%' }
        : { width: thickness, height: '100%' }),
      ...style,
    }} />
  );
}
