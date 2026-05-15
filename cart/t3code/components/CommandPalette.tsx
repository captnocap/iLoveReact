// T3 Code — Command Palette (1:1 behavior port)

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import type { Thread, Project, ThreadId } from '../types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  threads: Thread[];
  projects: Project[];
  activeThreadId: ThreadId | null;
  onSelectThread: (id: ThreadId) => void;
  onNewThread: (projectId: string) => void;
  onOpenSettings: () => void;
}

interface PaletteItem {
  id: string;
  title: string;
  description: string;
  run: () => void;
}

export default function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose, threads, projects, onSelectThread, onNewThread, onOpenSettings } = props;
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => { if (open) { setQuery(''); setSelectedIndex(0); } }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const all: PaletteItem[] = [];

    all.push({ id: 'action:new-thread', title: 'New thread', description: 'Start a new conversation', run: () => { onNewThread(projects[0]?.id ?? ''); onClose(); } });
    all.push({ id: 'action:settings', title: 'Open settings', description: 'Configure providers and preferences', run: () => { onOpenSettings(); onClose(); } });
    all.push({ id: 'action:close', title: 'Close palette', description: 'Dismiss command palette', run: onClose });

    for (const t of threads.filter(t => !t.archived)) {
      const project = projects.find(p => p.id === t.projectId);
      all.push({
        id: `thread:${t.id}`,
        title: t.title,
        description: project ? `${project.name} · ${project.cwd}` : 'Unknown project',
        run: () => { onSelectThread(t.id); onClose(); },
      });
    }

    for (const p of projects) {
      all.push({
        id: `project:${p.id}`,
        title: p.name,
        description: p.cwd,
        run: () => { onNewThread(p.id); onClose(); },
      });
    }

    if (!q) return all;
    return all.filter(it =>
      it.title.toLowerCase().includes(q) ||
      it.description.toLowerCase().includes(q)
    );
  }, [query, threads, projects, onSelectThread, onNewThread, onOpenSettings, onClose]);

  useEffect(() => { setSelectedIndex(0); }, [items.length]);

  const handleSubmit = useCallback(() => {
    const it = items[selectedIndex];
    if (it) it.run();
  }, [items, selectedIndex]);

  const handleKeyDown = useCallback((payload: any) => {
    const key = payload?.key ?? payload?.keyCode ?? 0;
    if (key === 27) { onClose(); return; }
    if (key === 38 || key === 'ArrowUp') { setSelectedIndex(i => Math.max(0, i - 1)); return; }
    if (key === 40 || key === 'ArrowDown') { setSelectedIndex(i => Math.min(items.length - 1, i + 1)); return; }
    if (key === 13 || key === 'Enter') { handleSubmit(); return; }
  }, [items.length, handleSubmit, onClose]);

  if (!open) return null;

  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 100,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Box style={{
        width: 640, maxWidth: '90%',
        backgroundColor: '#1a1a1f', borderRadius: 8,
        borderWidth: 1, borderColor: '#2a2a30',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        <Box style={{ padding: 12, borderBottomWidth: 1, borderColor: '#2a2a30' }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onKeyDown={handleKeyDown}
            placeholder="Search threads, projects, actions…"
            style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 14, width: '100%' }}
          />
        </Box>
        <ScrollView style={{ maxHeight: 420 }}>
          <Col style={{ padding: 6, gap: 2 }}>
            {items.length === 0 ? (
              <Text style={{ color: '#666', fontFamily: 'monospace', fontSize: 12, padding: 12 }}>No results</Text>
            ) : items.map((it, i) => (
              <Pressable key={it.id} onPress={it.run}>
                <Box style={{
                  flexDirection: 'column',
                  padding: 8, borderRadius: 4,
                  backgroundColor: i === selectedIndex ? '#2a2a35' : 'transparent',
                  gap: 2,
                }}>
                  <Text style={{ color: '#e8e8e8', fontFamily: 'monospace', fontSize: 13 }}>{it.title}</Text>
                  <Text style={{ color: '#888', fontFamily: 'monospace', fontSize: 10 }}>{it.description}</Text>
                </Box>
              </Pressable>
            ))}
          </Col>
        </ScrollView>
        <Row style={{ padding: 8, borderTopWidth: 1, borderColor: '#2a2a30', gap: 12 }}>
          <Text style={{ color: '#555', fontFamily: 'monospace', fontSize: 10 }}>↑↓ navigate · ↵ select · esc close</Text>
          <Text style={{ color: '#555', fontFamily: 'monospace', fontSize: 10 }}>{items.length} results</Text>
        </Row>
      </Box>
    </Box>
  );
}
