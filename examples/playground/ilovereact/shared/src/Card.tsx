import React from 'react';
import { Box, Text } from './primitives';
import type { Style } from './types';

export interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: Style;
  headerStyle?: Style;
  bodyStyle?: Style;
}

export function Card({ title, subtitle, children, style, headerStyle, bodyStyle }: CardProps) {
  const hasHeader = title || subtitle;

  return (
    <Box style={{
      backgroundColor: '#1e293b',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#334155',
      overflow: 'hidden',
      ...style,
    }}>
      {hasHeader && (
        <Box style={{
          padding: 12,
          borderBottomWidth: 1,
          borderColor: '#334155',
          gap: 2,
          ...headerStyle,
        }}>
          {title && (
            <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 'bold' }}>{title}</Text>
          )}
          {subtitle && (
            <Text style={{ color: '#94a3b8', fontSize: 11 }}>{subtitle}</Text>
          )}
        </Box>
      )}
      <Box style={{ padding: 12, ...bodyStyle }}>
        {children}
      </Box>
    </Box>
  );
}
