import React, { useState } from 'react';
import { Box, Text, Pressable } from '../../../../packages/shared/src';

function ErrorButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={(state) => ({
        backgroundColor: state.pressed ? '#1e293b' : state.hovered ? '#334155' : '#1e293b',
        borderWidth: 2,
        borderColor: state.hovered ? color : '#334155',
        borderRadius: 8,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
      })}
    >
      <Text style={{ color, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function BombComponent() {
  // This component throws during render
  throw new Error('Render explosion: component deliberately threw during render');
  return null;
}

export function ErrorTestStory() {
  const [triggerRenderError, setTriggerRenderError] = useState(false);

  return (
    <Box style={{ gap: 16, padding: 16 }}>
      <Text style={{ color: '#e2e8f0', fontSize: 18, fontWeight: '700' }}>
        Error Reporting Test
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 13 }}>
        Click buttons below to trigger different error types. A red overlay should appear at the bottom of the screen with the error details.
      </Text>

      <Box style={{ gap: 10 }}>
        <ErrorButton
          label="Throw in onClick handler"
          color="#ef4444"
          onPress={() => {
            throw new Error('Handler error: deliberate throw in onClick');
          }}
        />

        <ErrorButton
          label="TypeError (call non-function)"
          color="#f59e0b"
          onPress={() => {
            const notAFunction = null as any;
            notAFunction();
          }}
        />

        <ErrorButton
          label="ReferenceError (undefined var)"
          color="#f97316"
          onPress={() => {
            // @ts-ignore
            const x = thisVariableDoesNotExist;
          }}
        />

        <ErrorButton
          label="console.error with Error object"
          color="#8b5cf6"
          onPress={() => {
            console.error(new Error('Console.error test: error with stack trace'));
          }}
        />

        <ErrorButton
          label="Trigger render error (React)"
          color="#ec4899"
          onPress={() => {
            setTriggerRenderError(true);
          }}
        />
      </Box>

      {triggerRenderError && <BombComponent />}
    </Box>
  );
}
