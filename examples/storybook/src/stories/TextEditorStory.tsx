import React, { useState } from 'react';
import { Box, Text, TextEditor } from '../../../../packages/shared/src';

const SAMPLE_CODE = `function greet(name)
  print("Hello, " .. name .. "!")
end

-- Call the function
greet("world")

for i = 1, 10 do
  print(i)
end`;

export function TextEditorStory() {
  const [lastBlurValue, setLastBlurValue] = useState('');
  const [lastSubmitValue, setLastSubmitValue] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* Main editor */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>
          Document editor (click to focus, Esc to blur, Ctrl+Enter to submit)
        </Text>
        <TextEditor
          initialValue={SAMPLE_CODE}
          placeholder="Start typing..."
          onFocus={() => setFocused(true)}
          onBlur={(text) => {
            setFocused(false);
            setLastBlurValue(text);
          }}
          onSubmit={(text) => setLastSubmitValue(text)}
          style={{ width: '100%', height: 200, borderRadius: 6 }}
          textStyle={{ fontSize: 13 }}
        />
        <Text style={{ color: focused ? '#4A90D9' : '#555', fontSize: 11 }}>
          {focused ? 'Focused — editing in Lua (no bridge traffic)' : 'Unfocused — click to edit'}
        </Text>
      </Box>

      {/* Read-only editor */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Read-only</Text>
        <TextEditor
          initialValue="This editor is read-only.\nYou can select and copy, but not edit."
          readOnly
          style={{ width: '100%', height: 80, borderRadius: 6 }}
          textStyle={{ fontSize: 13 }}
        />
      </Box>

      {/* No line numbers */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>No line numbers</Text>
        <TextEditor
          initialValue="Line numbers hidden."
          lineNumbers={false}
          style={{ width: '100%', height: 60, borderRadius: 6 }}
          textStyle={{ fontSize: 13 }}
        />
      </Box>

      {/* Last blur/submit values */}
      {lastBlurValue !== '' && (
        <Box style={{ gap: 2 }}>
          <Text style={{ color: '#888', fontSize: 10 }}>Last blur value (first 80 chars):</Text>
          <Text style={{ color: '#a0a0b0', fontSize: 11 }}>
            {lastBlurValue.slice(0, 80)}...
          </Text>
        </Box>
      )}
      {lastSubmitValue !== '' && (
        <Box style={{ gap: 2 }}>
          <Text style={{ color: '#888', fontSize: 10 }}>Last submit value (first 80 chars):</Text>
          <Text style={{ color: '#22c55e', fontSize: 11 }}>
            {lastSubmitValue.slice(0, 80)}...
          </Text>
        </Box>
      )}
    </Box>
  );
}
