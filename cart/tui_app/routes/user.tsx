import * as React from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { Button, Field, Input, KeyValue } from '../components/Field';
import { SETTINGS_ID, USER_ID, nowIso, text, useUserStore } from '../settings';

function defaultUser(): any {
  return {
    id: USER_ID,
    email: '',
    activeSettingsId: SETTINGS_ID,
    createdAt: nowIso(),
    preferences: {
      responseDefault: 'concise',
      elaborateOnAsk: true,
      emojiOk: false,
      accommodations: [],
    },
    onboarding: {
      status: 'pending',
      step: 0,
      startedAt: nowIso(),
    },
  };
}

export function UserRoute() {
  const userStore = useUserStore();
  const { data: user, refetch } = userStore.useQuery(USER_ID);
  const [displayName, setDisplayName] = React.useState('');
  const [goal, setGoal] = React.useState('');
  const [configPath, setConfigPath] = React.useState('');
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    setDisplayName(text(user?.displayName || user?.name));
    setGoal(text(user?.goal || user?.bio));
    setConfigPath(text(user?.configPath));
  }, [user?.id, user?.displayName, user?.name, user?.goal, user?.bio, user?.configPath]);

  const save = async () => {
    setMessage('saving...');
    try {
      const cur = user || defaultUser();
      await userStore.create({
        ...cur,
        id: USER_ID,
        displayName: displayName.trim() || undefined,
        name: displayName.trim() || undefined,
        goal: goal.trim() || undefined,
        bio: goal.trim() || undefined,
        configPath: configPath.trim() || undefined,
        activeSettingsId: cur.activeSettingsId || SETTINGS_ID,
        createdAt: cur.createdAt || nowIso(),
      });
      refetch();
      setMessage('saved');
    } catch (e: any) {
      setMessage(`save failed: ${e?.message || String(e)}`);
    }
  };

  return (
    <Col style={{ width: '100%', padding: 1, gap: 1 }}>
      <Row style={{ gap: 2, paddingBottom: 1 }}>
        <Text style={{ color: '#fbbf24', fontWeight: 'bold' }}>user settings</Text>
        <Text style={{ color: '#64748b' }}>User.user_local</Text>
      </Row>

      <Col style={{ width: '100%', gap: 1 }}>
        <Field label="Name">
          <Input value={displayName} onChange={setDisplayName} placeholder="Display name" />
        </Field>
        <Field label="Goal">
          <Input value={goal} onChange={setGoal} placeholder="What should the assistant optimize for?" />
        </Field>
        <Field label="Config path">
          <Input value={configPath} onChange={setConfigPath} placeholder="~/.app/config" />
        </Field>
        <Row style={{ gap: 2 }}>
          <Button label="save user" onPress={save} />
          <Text style={{ color: message.startsWith('save failed') ? '#f87171' : '#94a3b8' }}>{message}</Text>
        </Row>
      </Col>

      <Box style={{ paddingTop: 1 }}>
        <Text style={{ color: '#fbbf24' }}>── current row ──</Text>
        <KeyValue label="name" value={text(user?.displayName || user?.name, '(empty)')} />
        <KeyValue label="goal" value={text(user?.goal || user?.bio, '(empty)')} />
        <KeyValue label="configPath" value={text(user?.configPath, '(empty)')} />
      </Box>
    </Col>
  );
}
