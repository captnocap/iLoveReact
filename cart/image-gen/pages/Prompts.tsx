import React from 'react';
import { Box, ScrollView, TextArea } from '../../../runtime/primitives';
import { C } from '../style.cls';
import * as db from '../db';
import { listPromptFiles, loadPromptFile, savePromptFile, deletePromptFile } from '../fs';

export default function PromptsPage() {
  const [prompts, setPrompts] = React.useState<db.Prompt[]>([]);
  const [filePrompts, setFilePrompts] = React.useState<string[]>([]);
  const [selectedName, setSelectedName] = React.useState('');
  const [text, setText] = React.useState('');
  const [newName, setNewName] = React.useState('');

  const refresh = () => {
    try {
      setPrompts(db.listPrompts());
      setFilePrompts(listPromptFiles());
    } catch {}
  };

  React.useEffect(() => {
    refresh();
  }, []);

  const selectPrompt = (name: string) => {
    setSelectedName(name);
    const dbPrompt = db.getPromptByName(name);
    if (dbPrompt) {
      setText(dbPrompt.text);
      return;
    }
    const fileText = loadPromptFile(name);
    if (fileText != null) {
      setText(fileText);
      // sync to db
      try { db.createPrompt({ name, text: fileText }); } catch {}
      refresh();
    }
  };

  const save = () => {
    if (!selectedName) return;
    try {
      savePromptFile(selectedName, text);
      db.createPrompt({ name: selectedName, text });
      refresh();
    } catch (e: any) {
      console.error('Save failed:', e.message);
    }
  };

  const createNew = () => {
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!name) return;
    try {
      savePromptFile(name, '');
      db.createPrompt({ name, text: '' });
      setNewName('');
      refresh();
      setSelectedName(name);
      setText('');
    } catch {}
  };

  const remove = (name: string) => {
    try {
      deletePromptFile(name);
      const existing = db.getPromptByName(name);
      if (existing) db.deletePrompt(existing.id);
      if (selectedName === name) {
        setSelectedName('');
        setText('');
      }
      refresh();
    } catch {}
  };

  const allNames = Array.from(new Set([...filePrompts, ...prompts.map((p) => p.name)])).sort();

  return (
    <C.AppBody>
      <Box style={{ flexDirection: 'row', gap: 'theme:spacingMd', flexGrow: 1 }}>
        <C.AppPanel style={{ width: 240, flexShrink: 0 }}>
          <C.AppPanelTitle>Prompts</C.AppPanelTitle>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <C.AppTextInput
              style={{ flexGrow: 1 }}
              value={newName}
              onChange={setNewName}
              placeholder="new-prompt-name"
            />
            <C.AppButton onPress={createNew}>
              <C.AppButtonLabel>New</C.AppButtonLabel>
            </C.AppButton>
          </Box>
          <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }}>
            <Box style={{ flexDirection: 'column', gap: 2 }}>
              {allNames.map((name) => (
                <C.AppListItem
                  key={name}
                  onPress={() => selectPrompt(name)}
                  style={{
                    backgroundColor: selectedName === name ? 'theme:bgElevated' : undefined,
                  }}
                >
                  <C.AppListItemText style={{ flexGrow: 1 }}>{name}</C.AppListItemText>
                  <C.AppDangerButton onPress={() => remove(name)}>
                    <C.AppDangerButtonLabel>×</C.AppDangerButtonLabel>
                  </C.AppDangerButton>
                </C.AppListItem>
              ))}
            </Box>
          </ScrollView>
        </C.AppPanel>

        <C.AppPanel style={{ flexGrow: 1 }}>
          <C.AppPanelTitle>{selectedName || 'Select a prompt'}</C.AppPanelTitle>
          {selectedName ? (
            <Box style={{ flexDirection: 'column', gap: 10, flexGrow: 1 }}>
              <TextArea
                style={{ flexGrow: 1, minHeight: 200, padding: 10, borderRadius: 8, backgroundColor: '#111a24', borderWidth: 1, borderColor: '#2e4159', color: '#eef5ff', fontSize: 14 }}
                value={text}
                onChange={setText}
                placeholder="Enter prompt text..."
              />
              <Box style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <C.AppButton onPress={save}>
                  <C.AppButtonLabel>Save</C.AppButtonLabel>
                </C.AppButton>
              </Box>
            </Box>
          ) : (
            <C.AppDim>Select a prompt from the list to edit.</C.AppDim>
          )}
        </C.AppPanel>
      </Box>
    </C.AppBody>
  );
}
