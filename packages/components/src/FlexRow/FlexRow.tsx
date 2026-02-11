import React from 'react';
import { Box, type Style } from '@ilovereact/core';

export interface FlexRowProps {
  gap?: number;
  justify?: Style['justifyContent'];
  align?: Style['alignItems'];
  wrap?: boolean;
  style?: Style;
  children: React.ReactNode;
}

export function FlexRow({
  gap,
  justify,
  align,
  wrap,
  style,
  children,
}: FlexRowProps) {
  return (
    <Box style={{
      flexDirection: 'row',
      ...(gap !== undefined && { gap }),
      ...(justify && { justifyContent: justify }),
      ...(align && { alignItems: align }),
      ...(wrap && { flexWrap: 'wrap' }),
      ...style,
    }}>
      {children}
    </Box>
  );
}
