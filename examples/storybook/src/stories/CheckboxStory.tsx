import React, { useState } from 'react';
import { Box, Text } from '../../../../packages/shared/src';
import { Checkbox } from '../../../../packages/shared/src/Checkbox';

export function CheckboxStory() {
  const [checked1, setChecked1] = useState(false);
  const [checked2, setChecked2] = useState(true);
  const [checked3, setChecked3] = useState(false);

  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* Basic checkbox */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Basic</Text>
        <Checkbox
          value={checked1}
          onValueChange={setChecked1}
          label="Accept terms"
        />
        <Checkbox
          value={checked2}
          onValueChange={setChecked2}
          label="Subscribe to newsletter"
        />
      </Box>

      {/* Custom colors */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Custom colors</Text>
        <Checkbox
          value={checked3}
          onValueChange={setChecked3}
          label="Green checkbox"
          color="#22c55e"
        />
        <Checkbox
          value={true}
          label="Purple (always checked)"
          color="#a855f7"
        />
      </Box>

      {/* Sizes */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Sizes</Text>
        <Checkbox value={true} size={14} label="Small (14px)" />
        <Checkbox value={true} size={20} label="Default (20px)" />
        <Checkbox value={true} size={28} label="Large (28px)" />
      </Box>

      {/* Disabled */}
      <Box style={{ gap: 8 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Disabled</Text>
        <Checkbox value={false} disabled label="Unchecked disabled" />
        <Checkbox value={true} disabled label="Checked disabled" />
      </Box>
    </Box>
  );
}
