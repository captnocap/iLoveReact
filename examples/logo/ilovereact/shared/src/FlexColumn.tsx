import React from 'react';
import { Box } from './primitives';
import type { Style } from './types';

export interface FlexColumnProps {
  gap?: number;
  justify?: Style['justifyContent'];
  align?: Style['alignItems'];
  style?: Style;
  children: React.ReactNode;
}

export function FlexColumn({
  gap,
  justify,
  align,
  style,
  children,
}: FlexColumnProps) {
  return (
    <Box style={{
      flexDirection: 'column',
      ...(gap !== undefined && { gap }),
      ...(justify && { justifyContent: justify }),
      ...(align && { alignItems: align }),
      ...style,
    }}>
      {children}
    </Box>
  );
}
