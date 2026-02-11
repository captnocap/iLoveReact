import React from 'react';
import { Box } from '@ilovereact/core';

export interface SpacerProps {
  size?: number;
}

export function Spacer({ size }: SpacerProps) {
  return size !== undefined
    ? <Box style={{ height: size }} />
    : <Box style={{ flexGrow: 1 }} />;
}
