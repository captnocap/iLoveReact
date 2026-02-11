/**
 * Playground — Main layout tying editor, preview, and status bar together.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, TextEditor } from '../ilovereact/shared/src';
import { Preview } from './Preview';
import { StatusBar } from './StatusBar';
import { lint } from './lib/linter';
import { transformJSX } from './lib/jsx-transform';
import { evalComponent } from './lib/eval-component';
import type { LintMessage } from './lib/linter';

const DEFAULT_CODE = `function MyComponent() {
  return (
    <Box style={{
      width: 200,
      height: 200,
      backgroundColor: '#89b4fa',
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    }}>
      <Text style={{
        color: '#1e1e2e',
        fontSize: 22,
        fontWeight: 'bold',
      }}>
        Hello
      </Text>
      <Text style={{
        color: '#313244',
        fontSize: 13,
      }}>
        Edit the code on the left
      </Text>
    </Box>
  );
}`;

export function App() {
  const initialCode = (globalThis as any).__devState?.code ?? DEFAULT_CODE;
  const [code, setCode] = useState(initialCode);
  const [UserComponent, setUserComponent] = useState<React.ComponentType | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [lintMessages, setLintMessages] = useState<LintMessage[]>([]);
  const [jumpToLine, setJumpToLine] = useState<number | undefined>(undefined);
  const debounceRef = useRef<any>(null);

  (globalThis as any).__currentPlaygroundCode = code;

  const processCode = useCallback((src: string) => {
    const msgs = lint(src);
    setLintMessages(msgs);
    const errs = msgs.filter(m => m.severity === 'error');
    if (errs.length > 0) { setErrors(errs.map(e => `Line ${e.line}: ${e.message}`)); return; }
    const result = transformJSX(src);
    if (result.errors.length > 0) { setErrors(result.errors.map(e => `Line ${e.line}:${e.col}: ${e.message}`)); return; }
    const evalResult = evalComponent(result.code);
    if (evalResult.error) { setErrors([evalResult.error]); return; }
    setErrors([]);
    setUserComponent(() => evalResult.component);
  }, []);

  useEffect(() => { processCode(code); }, []);

  const handleCodeChange = useCallback((src: string) => {
    setCode(src);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => processCode(src), 300);
  }, [processCode]);

  const handleJumpToLine = useCallback((line: number) => {
    setJumpToLine(line);
    setTimeout(() => setJumpToLine(undefined), 50);
  }, []);

  return (
    <Box style={{ flexDirection: 'row', width: '100%', height: '100%' }}>
      <Box style={{ width: '50%', height: '100%', borderRightWidth: 1, borderColor: '#1e293b' }}>
        <Box style={{ height: 32, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#181825', borderBottomWidth: 1, borderColor: '#1e293b' }}>
          <Text style={{ color: '#cdd6f4', fontSize: 12, fontWeight: 'bold' }}>Editor</Text>
          <Text style={{ color: '#585b70', fontSize: 10 }}>iLoveReact Playground</Text>
        </Box>
        <TextEditor
          initialValue={initialCode}
          onBlur={handleCodeChange}
          onSubmit={handleCodeChange}
          placeholder="Write JSX here..."
          style={{ flexGrow: 1, width: '100%' }}
          textStyle={{ fontSize: 13, fontFamily: 'monospace' }}
        />
        <StatusBar messages={lintMessages} onJumpToLine={handleJumpToLine} />
      </Box>
      <Preview UserComponent={UserComponent} errors={errors} />
    </Box>
  );
}
