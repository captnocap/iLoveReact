/**
 * StatusBar — Bottom bar showing lint status and error messages.
 */

import React from 'react';
import { Box, Text, Pressable } from '../ilovereact/shared/src';
import type { LintMessage } from './lib/linter';

interface StatusBarProps { messages: LintMessage[]; onJumpToLine?: (line: number) => void; }

export function StatusBar({ messages, onJumpToLine }: StatusBarProps) {
  const ec = messages.filter(m => m.severity === 'error').length;
  const wc = messages.filter(m => m.severity === 'warning').length;

  return (
    <Box style={{ backgroundColor: '#181825', borderTopWidth: 1, borderColor: '#1e293b', minHeight: 28 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, gap: 12 }}>
        {!messages.length ? (
          <Text style={{ color: '#a6e3a1', fontSize: 11 }}>0 errors, 0 warnings</Text>
        ) : (
          <>
            {ec > 0 && <Text style={{ color: '#f38ba8', fontSize: 11 }}>{ec} error{ec !== 1 ? 's' : ''}</Text>}
            {wc > 0 && <Text style={{ color: '#f9e2af', fontSize: 11 }}>{wc} warning{wc !== 1 ? 's' : ''}</Text>}
          </>
        )}
      </Box>
      {messages.length > 0 && (
        <Box style={{ paddingBottom: 4 }}>
          {messages.slice(0, 5).map((msg, i) => (
            <Pressable key={i} onPress={() => onJumpToLine?.(msg.line)} style={{ flexDirection: 'row', paddingLeft: 12, paddingRight: 12, paddingTop: 2, paddingBottom: 2, gap: 8 }}>
              <Text style={{ color: msg.severity === 'error' ? '#f38ba8' : '#f9e2af', fontSize: 10, width: 40 }}>L{msg.line}</Text>
              <Text style={{ color: '#a6adc8', fontSize: 10 }}>{msg.message}</Text>
            </Pressable>
          ))}
          {messages.length > 5 && (
            <Box style={{ paddingLeft: 12, paddingTop: 2 }}>
              <Text style={{ color: '#585b70', fontSize: 10 }}>+{messages.length - 5} more</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
