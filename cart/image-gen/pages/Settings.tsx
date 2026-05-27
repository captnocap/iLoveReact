import React from 'react';
import { Box } from '../../../runtime/primitives';
import { C } from '../style.cls';
import * as db from '../db';

export default function SettingsPage() {
  const [keys, setKeys] = React.useState<db.ApiKey[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newLabel, setNewLabel] = React.useState('');
  const [newKey, setNewKey] = React.useState('');
  const [newProvider, setNewProvider] = React.useState('nano-gpt');

  React.useEffect(() => {
    try {
      setKeys(db.listApiKeys());
    } catch (e: any) {
      console.error('Failed to load API keys:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = () => {
    try { setKeys(db.listApiKeys()); } catch {}
  };

  const addKey = () => {
    if (!newKey.trim()) return;
    try {
      db.createApiKey({
        provider: newProvider,
        label: newLabel || 'Unlabeled',
        key_value: newKey.trim(),
        is_active: true,
      });
      setNewLabel('');
      setNewKey('');
      refresh();
    } catch (e: any) {
      console.error('Failed to add key:', e.message);
    }
  };

  const toggleActive = (id: string) => {
    const key = db.getApiKey(id);
    if (!key) return;
    try {
      db.updateApiKey(id, { is_active: !key.is_active });
      refresh();
    } catch {}
  };

  const removeKey = (id: string) => {
    try { db.deleteApiKey(id); refresh(); } catch {}
  };

  return (
    <C.AppBody>
      <C.AppPanel>
        <C.AppPanelTitle>API Keys</C.AppPanelTitle>
        <C.AppSubtle>Store provider API keys for image generation.</C.AppSubtle>

        {loading ? (
          <C.AppDim>Loading...</C.AppDim>
        ) : keys.length === 0 ? (
          <C.AppDim>No API keys stored yet.</C.AppDim>
        ) : (
          <Box style={{ flexDirection: 'column', gap: 6 }}>
            {keys.map((k) => (
              <Box
                key={k.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: k.is_active ? 'theme:bgAlt' : 'theme:bg',
                  borderWidth: 1,
                  borderColor: k.is_active ? 'theme:borderFocus' : 'theme:border',
                }}
              >
                <Box style={{ flexDirection: 'column', flexGrow: 1, gap: 2 }}>
                  <C.AppListItemText>
                    {k.label} ({k.provider}) {k.is_active ? '● active' : '○ inactive'}
                  </C.AppListItemText>
                  <C.AppListItemDim>
                    {k.key_value.slice(0, 8)}...{k.key_value.slice(-4)}
                  </C.AppListItemDim>
                </Box>
                <C.AppButtonOutline onPress={() => toggleActive(k.id)}>
                  <C.AppButtonOutlineLabel>{k.is_active ? 'Deactivate' : 'Activate'}</C.AppButtonOutlineLabel>
                </C.AppButtonOutline>
                <C.AppDangerButton onPress={() => removeKey(k.id)}>
                  <C.AppDangerButtonLabel>Delete</C.AppDangerButtonLabel>
                </C.AppDangerButton>
              </Box>
            ))}
          </Box>
        )}
      </C.AppPanel>

      <C.AppPanel>
        <C.AppPanelTitle>Add Key</C.AppPanelTitle>
        <Box style={{ flexDirection: 'column', gap: 10 }}>
          <Box style={{ flexDirection: 'row', gap: 10 }}>
            <C.AppTextInput
              style={{ flexGrow: 1 }}
              value={newLabel}
              onChange={setNewLabel}
              placeholder="Label"
            />
            <C.AppTextInput
              style={{ width: 140 }}
              value={newProvider}
              onChange={setNewProvider}
              placeholder="Provider"
            />
          </Box>
          <C.AppTextInput
            value={newKey}
            onChange={setNewKey}
            placeholder="API key"
          />
          <C.AppButton onPress={addKey}>
            <C.AppButtonLabel>Add API Key</C.AppButtonLabel>
          </C.AppButton>
        </Box>
      </C.AppPanel>
    </C.AppBody>
  );
}
