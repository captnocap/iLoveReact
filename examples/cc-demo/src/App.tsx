/**
 * CC Demo — A simple dashboard that renders on a ComputerCraft terminal.
 *
 * Shows styled boxes and text to demonstrate the CC target pipeline:
 * React → Layout → Flatten → WebSocket → CC terminal
 */

import React, { useState, useEffect } from 'react';

function Clock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box style={{ backgroundColor: '#3366CC', padding: 1 }}>
      <Text style={{ color: 'white' }}>{time}</Text>
    </Box>
  );
}

function StatusCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box style={{ backgroundColor: color, padding: 1, flexGrow: 1 }}>
      <Text style={{ color: 'white' }}>{label}</Text>
      <Text style={{ color: 'yellow' }}>{value}</Text>
    </Box>
  );
}

// Simple wrappers — these map to the View/Text primitives the reconciler knows
function Box({ style, children }: { style?: any; children?: React.ReactNode }) {
  return <view style={style}>{children}</view>;
}

function Text({ style, children }: { style?: any; children?: React.ReactNode }) {
  return <text style={style}>{children}</text>;
}

export default function App() {
  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: 'black', flexDirection: 'column', gap: 1 }}>
      {/* Header */}
      <Box style={{ backgroundColor: '#7F664C', padding: 1 }}>
        <Text style={{ color: 'white' }}>iLoveReact CC Demo</Text>
      </Box>

      {/* Clock */}
      <Clock />

      {/* Status cards in a row */}
      <Box style={{ flexDirection: 'row', gap: 1 }}>
        <StatusCard label="CPU" value="42%" color="#57A64E" />
        <StatusCard label="MEM" value="1.2G" color="#B266E5" />
        <StatusCard label="NET" value="OK" color="#4C99B2" />
      </Box>

      {/* Footer */}
      <Box style={{ backgroundColor: '#4C4C4C', padding: 1 }}>
        <Text style={{ color: 'lightGray' }}>React in Minecraft!</Text>
      </Box>
    </Box>
  );
}
