import React from 'react';
import { Box, Text, type Style } from '@ilovereact/core';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: Style;
}

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  default: { bg: '#334155', text: '#e2e8f0' },
  success: { bg: '#166534', text: '#bbf7d0' },
  warning: { bg: '#854d0e', text: '#fef08a' },
  error:   { bg: '#991b1b', text: '#fecaca' },
  info:    { bg: '#1e40af', text: '#bfdbfe' },
};

export function Badge({ label, variant = 'default', style }: BadgeProps) {
  const colors = variantColors[variant];

  return (
    <Box style={{
      backgroundColor: colors.bg,
      borderRadius: 10,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 2,
      paddingBottom: 2,
      alignSelf: 'start',
      ...style,
    }}>
      <Text style={{ color: colors.text, fontSize: 11, fontWeight: 'bold' }}>{label}</Text>
    </Box>
  );
}
