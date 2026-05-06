// User route — identity, preferences, accommodations, and the linked
// rows from the Postgres-backed user bucket.

import { useEffect, useState } from 'react';
import { Box, Pressable } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { TRAITS } from '../../onboarding/traits';
import {
  Card,
  Field,
  Input,
  PillRow,
  Section,
  SETTINGS_ID,
  USER_ID,
} from '../shared';
import { useSettingsCtx } from '../page';

type ResponseDepth = 'minimal' | 'concise' | 'detailed';

type ProfileDraft = {
  displayName: string;
  email: string;
  bio: string;
  configPath: string;
  timezone: string;
};

const EM_DASH = '-';
const DEPTH_OPTIONS: ResponseDepth[] = ['minimal', 'concise', 'detailed'];
const DEPTH_LABELS: Record<ResponseDepth, string> = {
  minimal: 'Minimal',
  concise: 'Concise',
  detailed: 'Detailed',
};

function nowIso(): string {
  return new Date().toISOString();
}

function pickStr(...candidates: any[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return EM_DASH;
}

function pickRaw(...candidates: any[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

function fmtDate(iso: any): string {
  if (typeof iso !== 'string' || iso.length === 0) return EM_DASH;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

function defaultUserRow(): any {
  return {
    id: USER_ID,
    email: '',
    activeSettingsId: SETTINGS_ID,
    createdAt: nowIso(),
    preferences: defaultPreferences(),
    onboarding: {
      status: 'pending',
      step: 0,
      startedAt: nowIso(),
    },
  };
}

function defaultPreferences(): any {
  return {
    responseDefault: 'concise',
    elaborateOnAsk: true,
    emojiOk: false,
    accommodations: [],
  };
}

function prefOf(user: any): any {
  return { ...defaultPreferences(), ...(user?.preferences || {}) };
}

function onboardingOf(user: any): any {
  return user?.onboarding || {};
}

function Kv({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  const Text = mono ? S.Code : S.Body;
  return (
    <S.KV>
      <Box style={{ width: 172, flexShrink: 0 }}>
        <S.Body>{label}</S.Body>
      </Box>
      <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Text>{value == null || value === '' ? EM_DASH : String(value)}</Text>
      </Box>
    </S.KV>
  );
}

function BoolToggle({ label, value, onChange, disabled }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const options = value ? ['on', 'off'] : ['off', 'on'];
  return (
    <Field label={label}>
      <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const isOn = (opt === 'on') === value;
          const Chip = isOn ? S.AppTraitChipActive : S.AppTraitChip;
          const Label = isOn ? S.AppTraitChipTextActive : S.AppTraitChipText;
          return (
            <Pressable
              key={opt}
              onPress={disabled ? () => {} : () => onChange(opt === 'on')}
            >
              <Chip><Label>{opt === 'on' ? 'On' : 'Off'}</Label></Chip>
            </Pressable>
          );
        })}
      </Box>
    </Field>
  );
}

function ProfileCard() {
  const { user, userStore, reload } = useSettingsCtx();
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: '',
    email: '',
    bio: '',
    configPath: '',
    timezone: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      displayName: pickRaw(user?.displayName),
      email: pickRaw(user?.email),
      bio: pickRaw(user?.bio),
      configPath: pickRaw(user?.configPath),
      timezone: pickRaw(user?.preferences?.timezone),
    });
  }, [
    user?.id,
    user?.displayName,
    user?.email,
    user?.bio,
    user?.configPath,
    user?.preferences?.timezone,
  ]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const cur = user || defaultUserRow();
      const prefs = prefOf(cur);
      const next = {
        ...cur,
        id: USER_ID,
        displayName: draft.displayName.trim() || undefined,
        email: draft.email.trim() || undefined,
        bio: draft.bio.trim() || undefined,
        configPath: draft.configPath.trim() || undefined,
        activeSettingsId: cur.activeSettingsId || SETTINGS_ID,
        createdAt: cur.createdAt || nowIso(),
        preferences: {
          ...prefs,
          timezone: draft.timezone.trim() || undefined,
        },
        onboarding: cur.onboarding || defaultUserRow().onboarding,
      };
      if (user) await userStore.update(USER_ID, next);
      else await userStore.create(next);
      reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card gap={14}>
      <Box style={{ flexDirection: 'column', gap: 2 }}>
        <S.Caption>Identity</S.Caption>
        <S.Subheading>Profile</S.Subheading>
      </Box>
      <S.BodyDim>Stored on User.user_local in the Postgres user bucket.</S.BodyDim>

      <S.AppFormShell style={{ width: '100%', maxWidth: '100%' }}>
        <Field label="Display name">
          <Input
            value={draft.displayName}
            onChange={(v) => setDraft((d) => ({ ...d, displayName: v }))}
            placeholder="Name"
          />
        </Field>
        <Field label="Email">
          <Input
            value={draft.email}
            onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Bio">
          <Input
            value={draft.bio}
            onChange={(v) => setDraft((d) => ({ ...d, bio: v }))}
            placeholder="One-line context for assistant calibration"
          />
        </Field>
        <Field label="Config path">
          <Input
            mono
            value={draft.configPath}
            onChange={(v) => setDraft((d) => ({ ...d, configPath: v }))}
            placeholder="~/.app/config"
          />
        </Field>
        <Field label="Timezone">
          <Input
            mono
            value={draft.timezone}
            onChange={(v) => setDraft((d) => ({ ...d, timezone: v }))}
            placeholder="America/Los_Angeles"
          />
        </Field>

        {error ? (
          <S.AppProbeResult>
            <S.AppProbeFail>Save failed</S.AppProbeFail>
            <S.AppProbeMessage>{error}</S.AppProbeMessage>
          </S.AppProbeResult>
        ) : null}

        <S.AppFormButtonRow style={{ gap: 8 }}>
          <S.Button onPress={save}>
            <S.ButtonLabel>{saving ? 'Saving...' : 'Save profile'}</S.ButtonLabel>
          </S.Button>
        </S.AppFormButtonRow>
      </S.AppFormShell>
    </Card>
  );
}

function PreferencesCard() {
  const { user, userStore, reload } = useSettingsCtx();
  const prefs = prefOf(user);
  const accs = Array.isArray(prefs.accommodations) ? prefs.accommodations : [];
  const activeIds = new Set(accs.map((a: any) => a?.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writePrefs = async (nextPrefs: any) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const cur = user || defaultUserRow();
      const next = {
        ...cur,
        id: USER_ID,
        activeSettingsId: cur.activeSettingsId || SETTINGS_ID,
        createdAt: cur.createdAt || nowIso(),
        preferences: { ...prefOf(cur), ...nextPrefs },
        onboarding: cur.onboarding || defaultUserRow().onboarding,
      };
      if (user) await userStore.update(USER_ID, next);
      else await userStore.create(next);
      reload();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleTrait = async (traitId: string) => {
    const accId = `acc_${traitId}`;
    let nextAccs = accs;
    if (activeIds.has(accId)) {
      nextAccs = accs.filter((a: any) => a?.id !== accId);
    } else {
      const trait = TRAITS.find((t: any) => t.id === traitId);
      if (!trait) return;
      nextAccs = [...accs, { id: accId, label: trait.label, note: trait.note }];
    }
    await writePrefs({ accommodations: nextAccs });
  };

  return (
    <Card gap={16}>
      <Box style={{ flexDirection: 'column', gap: 2 }}>
        <S.Caption>Preferences</S.Caption>
        <S.Subheading>Response defaults</S.Subheading>
      </Box>

      <S.AppFormShell style={{ width: '100%', maxWidth: '100%' }}>
        <Field label="Default depth">
          <PillRow<ResponseDepth>
            options={DEPTH_OPTIONS}
            labels={DEPTH_LABELS}
            value={(prefs.responseDefault || 'concise') as ResponseDepth}
            onChange={(v) => writePrefs({ responseDefault: v })}
          />
        </Field>
        <BoolToggle
          label="Elaborate when asked"
          value={prefs.elaborateOnAsk !== false}
          disabled={busy}
          onChange={(v) => writePrefs({ elaborateOnAsk: v })}
        />
        <BoolToggle
          label="Emoji"
          value={prefs.emojiOk === true}
          disabled={busy}
          onChange={(v) => writePrefs({ emojiOk: v })}
        />
      </S.AppFormShell>

      <Box style={{ flexDirection: 'column', gap: 10 }}>
        <S.Caption>Accommodations</S.Caption>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TRAITS.map((t: any) => {
            const isOn = activeIds.has(`acc_${t.id}`);
            const Chip = isOn ? S.AppTraitChipActive : S.AppTraitChip;
            const Label = isOn ? S.AppTraitChipTextActive : S.AppTraitChipText;
            return (
              <Pressable key={t.id} onPress={busy ? () => {} : () => toggleTrait(t.id)}>
                <Chip><Label>{t.label}</Label></Chip>
              </Pressable>
            );
          })}
        </Box>
      </Box>

      {accs.length > 0 ? (
        <Box style={{ flexDirection: 'column', gap: 8 }}>
          <S.Caption>Active accommodation rows</S.Caption>
          {accs.map((a: any) => (
            <S.KV key={a.id || a.label}>
              <Box style={{ width: 172, flexShrink: 0 }}>
                <S.Body>{pickStr(a?.label)}</S.Body>
              </Box>
              <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                <S.Body>{pickStr(a?.note)}</S.Body>
              </Box>
            </S.KV>
          ))}
        </Box>
      ) : null}

      {error ? (
        <S.AppProbeResult>
          <S.AppProbeFail>Save failed</S.AppProbeFail>
          <S.AppProbeMessage>{error}</S.AppProbeMessage>
        </S.AppProbeResult>
      ) : null}
    </Card>
  );
}

function UserDbCard() {
  const { user, settings, privacy, connections, models } = useSettingsCtx();
  const prefs = prefOf(user);
  const onboarding = onboardingOf(user);
  const defaultConnection = connections.find((c: any) => c.id === settings?.defaultConnectionId);
  const actionDefaults = settings?.actionDefaults || {};
  const schedules = settings?.schedules || {};
  const extraKeys = Object.keys(user || {}).filter((key) => ![
    'id',
    'email',
    'displayName',
    'bio',
    'configPath',
    'activeSettingsId',
    'createdAt',
    'preferences',
    'onboarding',
  ].includes(key));

  return (
    <Card gap={16}>
      <Box style={{ flexDirection: 'column', gap: 2 }}>
        <S.Caption>Postgres user bucket</S.Caption>
        <S.Subheading>Connected rows</S.Subheading>
      </Box>

      <Box style={{ flexDirection: 'column', gap: 8 }}>
        <Kv label="User row" value={user?.id || USER_ID} mono />
        <Kv label="Created" value={fmtDate(user?.createdAt)} />
        <Kv label="Active settings id" value={pickStr(user?.activeSettingsId)} mono />
        <Kv label="Response default" value={pickStr(prefs.responseDefault)} />
        <Kv label="Elaborate on ask" value={prefs.elaborateOnAsk !== false ? 'yes' : 'no'} />
        <Kv label="Emoji ok" value={prefs.emojiOk === true ? 'yes' : 'no'} />
        <Kv label="Accommodation count" value={Array.isArray(prefs.accommodations) ? prefs.accommodations.length : 0} />
      </Box>

      <Box style={{ height: 1, backgroundColor: 'theme:rule' }} />

      <Box style={{ flexDirection: 'column', gap: 8 }}>
        <Kv label="Settings row" value={settings?.id || SETTINGS_ID} mono />
        <Kv label="Settings label" value={pickStr(settings?.label)} />
        <Kv label="Privacy row" value={settings?.privacyId || privacy?.id} mono />
        <Kv label="Default connection" value={defaultConnection?.label || settings?.defaultConnectionId} />
        <Kv label="Default model" value={settings?.defaultModelId} mono />
        <Kv label="Connections" value={connections.length} />
        <Kv label="Models cached" value={models.length} />
        <Kv label="Action bindings" value={Object.keys(actionDefaults).length} />
        <Kv label="Schedules" value={Object.keys(schedules).length} />
      </Box>

      <Box style={{ height: 1, backgroundColor: 'theme:rule' }} />

      <Box style={{ flexDirection: 'column', gap: 8 }}>
        <Kv label="Onboarding status" value={pickStr(onboarding.status)} />
        <Kv label="Onboarding step" value={onboarding.step ?? EM_DASH} />
        <Kv label="Started" value={fmtDate(onboarding.startedAt)} />
        <Kv label="Completed" value={fmtDate(onboarding.completedAt)} />
        <Kv label="Skipped" value={fmtDate(onboarding.skippedAt)} />
        <Kv label="Tour status" value={pickStr(onboarding.tourStatus)} />
      </Box>

      {extraKeys.length > 0 ? (
        <>
          <Box style={{ height: 1, backgroundColor: 'theme:rule' }} />
          <Box style={{ flexDirection: 'column', gap: 8 }}>
            <S.Caption>Additional user row fields</S.Caption>
            {extraKeys.map((key) => (
              <Kv
                key={key}
                label={key}
                value={
                  typeof user[key] === 'string'
                    ? user[key]
                    : JSON.stringify(user[key])
                }
                mono
              />
            ))}
          </Box>
        </>
      ) : null}
    </Card>
  );
}

export default function UserRoute() {
  const { user } = useSettingsCtx();
  return (
    <Section caption="Account" title="User">
      <Box style={{ flexDirection: 'column', gap: 16 }}>
        {!user ? (
          <S.AppProbeResult>
            <S.AppProbeFail>No user row</S.AppProbeFail>
            <S.AppProbeMessage>
              Saving this page will create User.user_local in the Postgres user bucket.
            </S.AppProbeMessage>
          </S.AppProbeResult>
        ) : null}
        <ProfileCard />
        <PreferencesCard />
        <UserDbCard />
      </Box>
    </Section>
  );
}
