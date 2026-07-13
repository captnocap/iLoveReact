import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text, TextInput } from '../primitives';
import type { SettingDefinition, SettingsStore } from './setting';

const COLOR = {
  bg: '#10151d', surface: '#151c26', border: '#283446', text: '#dbe5f3', dim: '#8190a3', primary: '#31d6e7', active: '#163d47',
};

function Button({ label, active = false, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingLeft: 10, paddingRight: 10, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: active ? COLOR.primary : COLOR.border, backgroundColor: active ? COLOR.active : COLOR.surface }}>
      <Text fontSize={11} color={active ? COLOR.primary : COLOR.text}>{label}</Text>
    </Pressable>
  );
}

function NumberControl({ store, def, value }: { store: SettingsStore; def: SettingDefinition; value: unknown }) {
  const step = def.step ?? 1;
  const number = typeof value === 'number' ? value : Number(def.defaultValue);
  const [draft, setDraft] = useState(String(number));
  useEffect(() => setDraft(String(number)), [number]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) store.set(def, next);
    else setDraft(String(number));
  };
  return (
    <Row style={{ gap: 5, alignItems: 'center' }}>
      <Button label="−" onPress={() => store.set(def, number - step)} />
      <TextInput
        value={draft}
        onChange={setDraft}
        onSubmit={commit}
        onBlur={commit}
        style={{ width: 74, height: 27, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: COLOR.border, borderRadius: 4, backgroundColor: '#0c1118', color: COLOR.text, fontSize: 11 }}
      />
      <Button label="+" onPress={() => store.set(def, number + step)} />
    </Row>
  );
}

function SettingControl({ store, def }: { store: SettingsStore; def: SettingDefinition }) {
  const value = store.snapshot()[def.id];
  if (def.kind === 'boolean') {
    return <Button label={value === true ? 'ON' : 'OFF'} active={value === true} onPress={() => store.set(def, value !== true)} />;
  }
  if (def.kind === 'enum') {
    return (
      <Row style={{ gap: 5 }}>
        {def.options?.map((option) => <Button key={option.value} label={option.label} active={value === option.value} onPress={() => store.set(def, option.value)} />)}
      </Row>
    );
  }
  return <NumberControl store={store} def={def} value={value} />;
}

/** Schema-generated Preferences content. Carts supply only declarations; this
 * component owns searching, controls, reset, and live store subscription. */
export function PreferencesPane({ store }: { store: SettingsStore }) {
  const [, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => store.subscribe(() => setRevision((revision) => revision + 1)), [store]);
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = store.registry.list().filter((def) => !needle || `${def.section} ${def.label} ${def.description} ${def.id}`.toLowerCase().includes(needle));
    const grouped = new Map<string, SettingDefinition[]>();
    for (const def of visible) grouped.set(def.section, [...(grouped.get(def.section) ?? []), def]);
    return [...grouped.entries()];
  }, [query, store]);

  return (
    <Col style={{ flexGrow: 1, minHeight: 0, gap: 10 }}>
      <Row style={{ gap: 8, alignItems: 'center' }}>
        <TextInput value={query} onChange={setQuery} placeholder="Search settings" style={{ flexGrow: 1, height: 30, paddingLeft: 9, paddingRight: 9, borderWidth: 1, borderColor: COLOR.border, borderRadius: 4, backgroundColor: '#0c1118', color: COLOR.text, fontSize: 11 }} />
        <Button label="Reset all" onPress={() => store.resetAll()} />
      </Row>
      <ScrollView style={{ flexGrow: 1, minHeight: 0 }} showScrollbar>
        <Col style={{ gap: 12, paddingRight: 4 }}>
          {sections.map(([section, defs]) => (
            <Col key={section} style={{ gap: 5 }}>
              <Text fontSize={10} color={COLOR.primary} fontWeight="700">{section.toUpperCase()}</Text>
              {defs.map((def) => (
                <Row key={def.id} style={{ minHeight: 42, alignItems: 'center', gap: 12, paddingLeft: 10, paddingRight: 8, paddingTop: 7, paddingBottom: 7, borderWidth: 1, borderColor: COLOR.border, borderRadius: 5, backgroundColor: COLOR.surface }} tooltip={def.description}>
                  <Text fontSize={12} color={COLOR.text} style={{ flexGrow: 1 }}>{def.label}</Text>
                  <SettingControl store={store} def={def} />
                  <Pressable onPress={() => store.reset(def)} tooltip={`Reset ${def.label}`} style={{ width: 28, height: 27, alignItems: 'center', justifyContent: 'center' }}>
                    <Text fontSize={12} color={COLOR.dim}>↺</Text>
                  </Pressable>
                </Row>
              ))}
            </Col>
          ))}
          {sections.length === 0 ? <Box style={{ padding: 12 }}><Text fontSize={11} color={COLOR.dim}>No matching settings</Text></Box> : null}
        </Col>
      </ScrollView>
    </Col>
  );
}
