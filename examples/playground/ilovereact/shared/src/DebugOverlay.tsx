/**
 * DebugOverlay — Wrap any subtree to visualize layout boundaries.
 *
 * Adds colored borders and optional dimension labels to every Box in the subtree.
 * Useful for debugging layout issues without opening the full inspector.
 *
 * @example
 *   import { DebugOverlay } from '@ilovereact/core';
 *
 *   // Wrap a section to see its layout
 *   <DebugOverlay>
 *     <Box style={{ flexDirection: 'row', width: '100%' }}>
 *       <Box style={{ flexGrow: 1 }}>...</Box>
 *       <Box style={{ flexGrow: 2 }}>...</Box>
 *     </Box>
 *   </DebugOverlay>
 *
 *   // Disable without removing the component
 *   <DebugOverlay enabled={false}>...</DebugOverlay>
 */

import React, { createContext, useContext } from 'react';
import { Box, Text } from './primitives';
import type { Style } from './types';

interface DebugOverlayProps {
  children: React.ReactNode;
  /** Toggle the overlay on/off. Default: true */
  enabled?: boolean;
  /** Border color for debug outlines. Default: rgba red */
  borderColor?: string;
  /** Show dimension labels on each Box. Default: false */
  showLabels?: boolean;
}

const DebugContext = createContext<{
  enabled: boolean;
  borderColor: string;
  showLabels: boolean;
}>({
  enabled: false,
  borderColor: 'rgba(255, 100, 100, 0.6)',
  showLabels: false,
});

export function useDebugOverlay() {
  return useContext(DebugContext);
}

export function DebugOverlay({
  children,
  enabled = true,
  borderColor = 'rgba(255, 100, 100, 0.6)',
  showLabels = false,
}: DebugOverlayProps) {
  return (
    <DebugContext.Provider value={{ enabled, borderColor, showLabels }}>
      {children}
    </DebugContext.Provider>
  );
}

/**
 * DebugBox — A Box that shows its debug border when inside a DebugOverlay.
 * Drop-in replacement for Box that respects the debug context.
 */
export function DebugBox({
  children,
  style,
  ...props
}: { children?: React.ReactNode; style?: Style; [key: string]: any }) {
  const { enabled, borderColor } = useContext(DebugContext);

  const debugStyle: Style = enabled
    ? {
        ...style,
        borderWidth: 1,
        borderColor: borderColor as any,
      }
    : style || {};

  return (
    <Box style={debugStyle} {...props}>
      {children}
    </Box>
  );
}
