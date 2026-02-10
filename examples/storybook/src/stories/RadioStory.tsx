import React, { useState } from 'react';
import { Box, Text } from '../../../../packages/shared/src';
import { RadioGroup, Radio } from '../../../../packages/shared/src/Radio';

export function RadioStory() {
  const [fruit, setFruit] = useState('apple');
  const [size, setSize] = useState('medium');

  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* Basic radio group */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Favorite fruit</Text>
        <RadioGroup value={fruit} onValueChange={setFruit}>
          <Radio value="apple" label="Apple" />
          <Radio value="banana" label="Banana" />
          <Radio value="cherry" label="Cherry" />
          <Radio value="grape" label="Grape" />
        </RadioGroup>
        <Text style={{ color: '#64748b', fontSize: 12 }}>
          Selected: {fruit}
        </Text>
      </Box>

      {/* Custom colors */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Custom colors</Text>
        <RadioGroup value={size} onValueChange={setSize}>
          <Radio value="small" label="Small" color="#22c55e" />
          <Radio value="medium" label="Medium" color="#f59e0b" />
          <Radio value="large" label="Large" color="#ef4444" />
        </RadioGroup>
      </Box>

      {/* Disabled group */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Disabled group</Text>
        <RadioGroup value="opt1" disabled>
          <Radio value="opt1" label="Option 1" />
          <Radio value="opt2" label="Option 2" />
        </RadioGroup>
      </Box>
    </Box>
  );
}
