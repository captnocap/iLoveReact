import React, { useState } from 'react';
import { Box, Text, Pressable } from '../ilovereact/shared/src';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <Box style={{
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 20,
    }}>
      <Text style={{ color: '#e2e8f0', fontSize: 24, fontWeight: '700' }}>
        iLoveReact
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14 }}>
        Edit src/App.tsx and watch it reload
      </Text>
      <Pressable
        onPress={() => setCount(c => c + 1)}
        style={(state) => ({
          backgroundColor: state.pressed ? '#2563eb' : state.hovered ? '#3b82f6' : '#1d4ed8',
          paddingLeft: 20,
          paddingRight: 20,
          paddingTop: 10,
          paddingBottom: 10,
          borderRadius: 8,
        })}
      >
        <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>
          Count: {count}
        </Text>
      </Pressable>
    </Box>
  );
}
