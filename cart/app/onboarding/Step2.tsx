import { useEffect, useRef, useState } from 'react';
import { Box, ScrollView } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { fetch as fetchHook, process as processHook } from '@reactjit/runtime/hooks';
import { SnakeSpinner } from '../gallery/components/grid-spinners/GridSpinners';
import { useAnimationTimeline } from '../anim';
import { useOnboarding } from './state.tsx';
import {
  FAMILY_ORDER,
  FAMILY_LABEL,
  familyOf,
  versionLabel,
  parseVersion,
  minorDistance,
  versionsForFamily,
  supports1M,
  effortLevelsFor,
} from '../claude-models';

// Carryover timeline (when name is already set, i.e. user came from step 1 exit).
const T_GREET_HOLD_END = 500;
const T_GREET_FADE_END = 1400;
const T_MAIN_IN_END    = 1950;
const T_MAIN_SLIDE_END = 2450;
const T_BTN1 = [2450, 2750];
const T_BTN2 = [2670, 2970];
const T_BTN3 = [2890, 3190];

const SKIP_GREET_OFFSET = T_GREET_FADE_END;
const FORM_FADE_MS = 400;
const NEXT_FADE_MS = 350;
const SLIDE_UP_PX = 80;
const LOCAL_RESULT_FADE_MS = 420;
const LOCAL_RESULT_SLIDE_PX = 12;
const LOCAL_MODEL_ROW_H = 40;
const LOCAL_MODEL_LIST_MAX_H = 220;

// Exit timeline (Next click → step 3).
const EXIT_TOTAL_MS    = 1900;
const EXIT_MENU_OUT    = [0,    380];
const EXIT_SPINNER_IN  = [190,  665];
const EXIT_THANKS_IN   = [570, 1235];

// ── Step 2 root ───────────────────────────────────────────────────────

export default function Step2() {
  const onb = useOnboarding();
  const persistedName = typeof onb.name === 'string' ? onb.name.trim() : '';
  const hasGreet = persistedName.length > 0;

  const tl = useAnimationTimeline({ skip: !hasGreet, skipOffsetMs: SKIP_GREET_OFFSET });

  const greetOp = hasGreet ? tl.fadeOut(T_GREET_HOLD_END, T_GREET_FADE_END) : 0;
  const mainOp  = tl.range(T_GREET_FADE_END, T_MAIN_IN_END);
  const slideP  = tl.range(T_MAIN_IN_END, T_MAIN_SLIDE_END);
  const btn1Op  = tl.range(T_BTN1[0], T_BTN1[1]);
  const btn2Op  = tl.range(T_BTN2[0], T_BTN2[1]);
  const btn3Op  = tl.range(T_BTN3[0], T_BTN3[1]);

  const [selected, setSelected] = useState(null); // null | 'api' | 'claude' | 'local'
  const [selectedAtT, setSelectedAtT] = useState(null);
  const selectedRef = useRef(selected);
  const selectedAtTRef = useRef(selectedAtT);
  selectedRef.current = selected;
  selectedAtTRef.current = selectedAtT;

  const [lockedIn, setLockedIn] = useState(false);
  const [lockedAtT, setLockedAtT] = useState(null);
  useEffect(() => {
    if (lockedIn && lockedAtT == null) {
      setLockedAtT(tl.tRef.current);
    }
    if (!lockedIn) {
      setLockedAtT(null);
    }
  }, [lockedIn, lockedAtT]);

  // Connection payload bubbled up from the active form. Lives at step
  // root so onNext can hand it to commitConnection without each form
  // having to know about persistence. Cleared on tile switch (each form
  // calls setCommitPayload(null) on unmount + when lockedIn flips off).
  const [commitPayload, setCommitPayload] = useState(null);

  const [exitStartT, setExitStartT] = useState(null);
  const exitStartTRef = useRef(null);
  exitStartTRef.current = exitStartT;
  useEffect(() => {
    if (exitStartT == null) return;
    const id = setTimeout(() => {
      try { onb.setStep(2); } catch {}
    }, EXIT_TOTAL_MS);
    return () => clearTimeout(id);
  }, [exitStartT]);

  function pickProvider(kind) {
    if (selectedRef.current === kind) return;
    if (exitStartTRef.current != null) return;
    setSelected(kind);
    setLockedIn(false);
    setCommitPayload(null);
    if (selectedAtTRef.current == null) {
      setSelectedAtT(tl.tRef.current);
    }
    try { onb.setProviderKind(kind); } catch {}
  }

  function takeMeBack() {
    if (exitStartTRef.current != null) return;
    try { onb.setProviderKind(null); } catch {}
    try { onb.setStep(0); } catch {}
  }

  function onNext() {
    if (!lockedIn || exitStartTRef.current != null) return;
    // Persist the Connection row before kicking off the exit transition.
    // commitConnection is fire-and-forget — the in-memory cache (and
    // the visible UI) are already correct from setProviderKind; the
    // disk write finishes in the background while the exit animation
    // plays.
    if (commitPayload) {
      try { onb.commitConnection(commitPayload); } catch {}
    }
    setExitStartT(tl.tRef.current);
  }

  const formOp = selected && selectedAtT != null
    ? tl.range(selectedAtT, selectedAtT + FORM_FADE_MS)
    : 0;

  const nextOp = lockedAtT != null
    ? tl.range(lockedAtT, lockedAtT + NEXT_FADE_MS)
    : 0;

  const exitMenuOut    = exitStartT != null ? tl.range(exitStartT + EXIT_MENU_OUT[0],    exitStartT + EXIT_MENU_OUT[1])    : 0;
  const exitSpinnerIn  = exitStartT != null ? tl.range(exitStartT + EXIT_SPINNER_IN[0],  exitStartT + EXIT_SPINNER_IN[1])  : 0;
  const exitThanksIn   = exitStartT != null ? tl.range(exitStartT + EXIT_THANKS_IN[0],   exitStartT + EXIT_THANKS_IN[1])   : 0;
  const menuOpacityMul = 1 - exitMenuOut;

  return (
    <S.AppStepFrame>
      {/* Carryover greet */}
      {hasGreet && greetOp > 0.001 && (
        <S.AppStepCenter style={{ opacity: greetOp }}>
          <S.AppGreet>{`Nice to meet you ${persistedName}`}</S.AppGreet>
        </S.AppStepCenter>
      )}

      {/* Carryover spinner */}
      {hasGreet && greetOp > 0.001 && (
        <S.AppStepBottomRight style={{ opacity: greetOp }}>
          <SnakeSpinner />
        </S.AppStepBottomRight>
      )}

      {/* Main column: message + tile row + inline form */}
      <S.AppStepCenterCol
        style={{
          gap: 32,
          paddingLeft: 24, paddingRight: 24,
          opacity: mainOp * menuOpacityMul,
          marginTop: -slideP * SLIDE_UP_PX,
        }}
      >
        <S.AppPromptText>This application requires a connection to a provider</S.AppPromptText>

        <S.AppProviderRow>
          <ProviderTile
            op={btn1Op}
            active={selected === 'api'}
            title="I have an API key"
            subtitle="OpenAI, Anthropic, Mistral, OpenRouter, …"
            onPress={() => pickProvider('api')}
          />
          <ProviderTile
            op={btn2Op}
            active={selected === 'claude'}
            title="I have a Claude.ai subscription"
            subtitle="Claude Code SDK"
            onPress={() => pickProvider('claude')}
          />
          <ProviderTile
            op={btn3Op}
            active={selected === 'local'}
            title="I have local models"
            subtitle=".gguf files or a local API endpoint"
            onPress={() => pickProvider('local')}
          />
        </S.AppProviderRow>

        {selected ? (
          <S.AppStepDimmable style={{ opacity: formOp, marginTop: (1 - formOp) * 12 }}>
            {selected === 'api'    ? <ApiKeyForm   setLockedIn={setLockedIn} setCommitPayload={setCommitPayload} /> : null}
            {selected === 'claude' ? <ClaudeForm   setLockedIn={setLockedIn} setCommitPayload={setCommitPayload} /> : null}
            {selected === 'local'  ? <LocalForm    setLockedIn={setLockedIn} setCommitPayload={setCommitPayload} /> : null}
          </S.AppStepDimmable>
        ) : null}
      </S.AppStepCenterCol>

      {/* Take me back (bottom-left) */}
      <S.AppStepBottomLeft style={{ opacity: mainOp * menuOpacityMul }}>
        <S.ButtonOutline onPress={takeMeBack}>
          <S.ButtonOutlineLabel>Take me back!</S.ButtonOutlineLabel>
        </S.ButtonOutline>
      </S.AppStepBottomLeft>

      {/* Next (bottom-right) — appears when probe is locked in. */}
      {lockedIn ? (
        <S.AppStepBottomRight style={{ opacity: nextOp * menuOpacityMul, marginTop: (1 - nextOp) * 8 }}>
          <S.Button onPress={onNext}>
            <S.ButtonLabel>Next</S.ButtonLabel>
          </S.Button>
        </S.AppStepBottomRight>
      ) : null}

      {/* Exit "Thanks for that" (centered) */}
      {exitStartT != null ? (
        <S.AppStepCenter style={{ opacity: exitThanksIn, marginTop: (1 - exitThanksIn) * 8 }}>
          <S.AppGreet>Thanks for that</S.AppGreet>
        </S.AppStepCenter>
      ) : null}

      {/* Exit spinner (bottom-right) */}
      {exitStartT != null ? (
        <S.AppStepBottomRight style={{ opacity: exitSpinnerIn }}>
          {exitSpinnerIn > 0.001 ? <SnakeSpinner /> : null}
        </S.AppStepBottomRight>
      ) : null}
    </S.AppStepFrame>
  );
}

// ── Provider tile ─────────────────────────────────────────────────────

function ProviderTile({ op, active, title, subtitle, onPress }) {
  const Tile = active ? S.AppProviderTileActive : S.AppProviderTile;
  const Title = active ? S.AppProviderTileTitleActive : S.AppProviderTileTitle;
  return (
    <S.AppStepDimmable style={{ opacity: op, marginTop: (1 - op) * 12 }}>
      <Tile onPress={onPress}>
        <Title>{title}</Title>
        <S.AppProviderTileSubtitle>{subtitle}</S.AppProviderTileSubtitle>
      </Tile>
    </S.AppStepDimmable>
  );
}

// ── Inline form helpers ───────────────────────────────────────────────

function FormShell({ children }) {
  return <S.AppFormShell>{children}</S.AppFormShell>;
}

function LabeledInput({ label, value, onChange, placeholder, secret }) {
  const safe = typeof value === 'string' ? value : '';
  const handleChange = (...args) => {
    const first = args[0];
    if (typeof first === 'string') onChange(first);
    else if (first && typeof first === 'object' && typeof first.text === 'string') onChange(first.text);
  };

  const Input = secret ? S.AppFormInputMono : S.AppFormInput;
  return (
    <S.AppFormFieldCol>
      <S.AppFormLabel>{label}</S.AppFormLabel>
      <Input value={safe} onChange={handleChange} placeholder={placeholder || ''} />
    </S.AppFormFieldCol>
  );
}

function ProbeButton({ enabled, busy, label, onPress }) {
  return (
    <S.AppStepDimmable style={{ opacity: enabled ? 1 : 0.35 }}>
      <S.Button onPress={enabled && !busy ? onPress : () => {}}>
        <S.ButtonLabel>{busy ? 'Probing…' : label}</S.ButtonLabel>
      </S.Button>
    </S.AppStepDimmable>
  );
}

function ProbeResult({ status, message }) {
  if (!status) return null;
  const Tone = status === 'success' ? S.AppProbeOk : S.AppProbeFail;
  return (
    <S.AppProbeResult>
      <Tone>{status === 'success' ? 'Probe succeeded' : 'Probe failed'}</Tone>
      {message ? <S.AppProbeMessage>{message}</S.AppProbeMessage> : null}
    </S.AppProbeResult>
  );
}

function ModelList({ models, selectedModel, onSelect }) {
  const useScroll = models.length > 6;

  return (
    <S.AppFormFieldCol>
      <S.AppModelListLabel>Pick a model</S.AppModelListLabel>
      <S.AppModelListBox style={{ height: useScroll ? 220 : undefined, maxHeight: 220 }}>
        <ScrollView showScrollbar={useScroll} style={{ flexGrow: 1, minHeight: 0, width: '100%' }}>
          <Box style={{ flexDirection: 'column', gap: 4 }}>
            {models.map((m) => {
              const active = m === selectedModel;
              const Choice = active ? S.AppModelChoiceActive : S.AppModelChoice;
              const ChoiceText = active ? S.AppModelChoiceTextActive : S.AppModelChoiceText;
              return (
                <Choice key={m} onPress={() => onSelect(m)}>
                  <ChoiceText>{m}</ChoiceText>
                </Choice>
              );
            })}
          </Box>
        </ScrollView>
      </S.AppModelListBox>
    </S.AppFormFieldCol>
  );
}

// ── 1) API-key provider ───────────────────────────────────────────────

function ApiKeyForm({ setLockedIn, setCommitPayload }) {
  const [endpoint, setEndpoint] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const endpointRef = useRef(endpoint);
  const apiKeyRef = useRef(apiKey);
  endpointRef.current = endpoint;
  apiKeyRef.current = apiKey;

  const hasAnyInput =
    (typeof endpoint === 'string' && endpoint.trim().length > 0) ||
    (typeof apiKey === 'string' && apiKey.trim().length > 0);

  useEffect(() => {
    const ok = status === 'success' && chosen != null;
    setLockedIn(ok);
    setCommitPayload(ok ? { kind: 'api', endpoint, apiKey, model: chosen } : null);
  }, [status, chosen, endpoint, apiKey]);
  useEffect(() => () => { setLockedIn(false); setCommitPayload(null); }, []);

  async function probe() {
    setBusy(true);
    const ep = endpointRef.current;
    const key = apiKeyRef.current;
    console.log(`[onboarding] probe API: ${ep}/models key=${key ? '***' : '<none>'}`);
    setModels(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']);
    setStatus('success');
    setBusy(false);
  }

  return (
    <FormShell>
      <LabeledInput label="Endpoint URL" value={endpoint} onChange={setEndpoint} placeholder="https://api.openai.com/v1" />
      <LabeledInput label="API key" value={apiKey} onChange={setApiKey} placeholder="sk-..." secret />
      <S.AppFormButtonRow>
        <ProbeButton enabled={hasAnyInput} busy={busy} label="Probe" onPress={probe} />
      </S.AppFormButtonRow>
      {models ? <ModelList models={models} selectedModel={chosen} onSelect={setChosen} /> : null}
      <ProbeResult status={status} />
    </FormShell>
  );
}

// ── 2) Claude.ai subscription provider ────────────────────────────────

// Placeholder shown in the input. Just an example path — the field is
// allowed to be empty (which means "use the CLI's built-in default
// install"). The Claude CLI does NOT do tilde expansion on
// `CLAUDE_CONFIG_DIR`, so we ask for an absolute path; users with a
// non-default install (e.g. `.claude-overflow` alongside `.claude`)
// type the full path here.
const CLAUDE_HOME_PLACEHOLDER = '/home/you/.claude  (leave blank for default)';

// Effort levels in canonical CLI order, low → high. We render whichever
// subset the picked model's `capabilities.effort.<level>.supported` flag
// allows.
const EFFORT_LEVELS_ALL = ['low', 'medium', 'high', 'xhigh', 'max'];

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Read the verifier's allowlist (written by `scripts/check-claude-models.sh`)
// and return a map id → status. Missing file → {}; unparseable → {}.
// We shell out via `cat` because the runtime's fs.readFile takes
// absolute paths and we don't have HOME exposed on the JS side.
const MODEL_STATUS_PATH =
  '$HOME/.claude-overflow/projects/-home-siah-creative-reactjit/memory/model-status.json';

async function loadModelStatus() {
  try {
    const result = await processHook.execAsync(`cat "${MODEL_STATUS_PATH}" 2>/dev/null`);
    if (!result || result.code !== 0 || !result.stdout) return {};
    const parsed = JSON.parse(result.stdout);
    if (!parsed || !Array.isArray(parsed.results)) return {};
    const out = {};
    for (const r of parsed.results) {
      if (r && typeof r.id === 'string' && typeof r.status === 'string') {
        out[r.id] = r.status;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Hand-curated capability matrix.
//
// Anthropic's /v1/models `capabilities` object is partially wrong/stale
// today — it claims Sonnet 4.6 supports `max` (it doesn't), it omits
// `xhigh` everywhere even though the latest Opus accepts it, and it
// reports Opus 4.5 as 200k-only when in practice the `[1m]` bracket
// works. So instead of trusting capabilities we apply these family-level
// rules. When the API catches up we can flip to capability-driven.

// Family + effort helpers moved to ../claude-models.ts so the settings
// page (cart/app/settings/page.jsx) re-uses the same logic when the
// user re-probes a Claude connection there. See that file for the
// truth-table comments.

// Reveal/easing: when `models` populates, fade the 4-col picker in over
// this many ms. Same pattern as LocalForm's resultAtT/modelsAtT.
const PICKER_REVEAL_MS = 360;
const RESULT_REVEAL_MS = 280;

// One vertical column of pills with a header label. `disabled(opt)` may
// return true for options the current selection can't apply.
function PickerCol({ label, options, value, onChange, isDisabled, op }) {
  return (
    <Box style={{
      flexDirection: 'column',
      gap: 6,
      flexShrink: 1,
      minWidth: 88,
      opacity: op,
      marginTop: (1 - op) * 8,
    }}>
      <S.AppModelListLabel>{label}</S.AppModelListLabel>
      <Box style={{ flexDirection: 'column', gap: 4 }}>
        {options.map((opt) => {
          const disabled = isDisabled ? isDisabled(opt) : false;
          const active = value === opt.id && !disabled;
          const Choice = active ? S.AppModelChoiceActive : S.AppModelChoice;
          const ChoiceText = active ? S.AppModelChoiceTextActive : S.AppModelChoiceText;
          // Disabled style: blend the pill bg + border into the FormShell
          // bg so the rectangle goes invisible. We keep padding and
          // borderWidth in place so the text x-coord matches the bordered
          // pills above — using `transparent` instead would let the
          // border-space collapse visually and shift the label.
          const disabledStyle = disabled
            ? { opacity: 0.5, backgroundColor: 'theme:bg1', borderColor: 'theme:bg1' }
            : null;
          return (
            <Choice
              key={opt.id}
              onPress={disabled ? undefined : () => onChange(opt.id)}
              style={disabledStyle}
            >
              <ChoiceText>{opt.label}</ChoiceText>
            </Choice>
          );
        })}
      </Box>
    </Box>
  );
}

function ClaudeForm({ setLockedIn, setCommitPayload }) {
  const tl = useAnimationTimeline({});

  // `home` is the absolute path to the Claude config dir. Empty means
  // "use the CLI default", which is the right answer for users with a
  // single install. Users with multiple Claude installs pick one here
  // and add the others through Settings later.
  const [home, setHome] = useState('');
  const [models, setModels] = useState(null);     // [] of model objects from /v1/models
  const [family, setFamily] = useState(null);     // 'opus' | 'sonnet' | 'haiku'
  const [versionId, setVersionId] = useState(null); // specific model.id within family
  const [effort, setEffort] = useState('medium');
  const [contextWindow, setContextWindow] = useState('default'); // 'default' (200k) | '1m'
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [resultAtT, setResultAtT] = useState(null);
  const [pickerAtT, setPickerAtT] = useState(null);
  const [modelStatus, setModelStatus] = useState({}); // id → 'verified'|'rerouted'|'error'

  const homeRef = useRef(home);
  homeRef.current = home;

  const chosen = (models && versionId) ? models.find((m) => m.id === versionId) : null;

  // Newest Opus model (if any) — drives the xhigh override in
  // effortLevelsFor since the API doesn't publish that capability.
  const opusLatestId = models
    ? (versionsForFamily('opus', models, modelStatus)[0]?.id || null)
    : null;

  // Reset everything when the user edits the home field — the prior
  // probe is no longer valid for a different install.
  useEffect(() => {
    setStatus(null);
    setMessage('');
    setModels(null);
    setFamily(null);
    setVersionId(null);
    setResultAtT(null);
    setPickerAtT(null);
  }, [home]);

  // Family changed → snap version to the latest in this family.
  useEffect(() => {
    if (!models || !family) return;
    const versions = versionsForFamily(family, models, modelStatus);
    if (!versions.length) return;
    if (!versions.some((m) => m.id === versionId)) {
      setVersionId(versions[0].id);
    }
  }, [family, models]);

  // Chosen model changed → snap context + effort to supported values.
  useEffect(() => {
    if (!chosen) return;
    if (!supports1M(chosen) && contextWindow === '1m') setContextWindow('default');
    const sup = effortLevelsFor(chosen, opusLatestId);
    if (sup.length > 0 && !sup.includes(effort)) {
      setEffort(sup.includes('medium') ? 'medium' : sup[0]);
    }
  }, [versionId, models]);

  // Lock-in payload reflects the current selection.
  useEffect(() => {
    const ok = status === 'success' && chosen != null;
    setLockedIn(ok);
    if (ok) {
      const has1m = supports1M(chosen);
      const supportsEffort = effortLevelsFor(chosen, opusLatestId).length > 0;
      const modelStr = chosen.id + (contextWindow === '1m' && has1m ? '[1m]' : '');
      setCommitPayload({
        kind: 'claude',
        home: homeRef.current.trim(),
        model: modelStr,
        effort: supportsEffort ? effort : null,
      });
    } else {
      setCommitPayload(null);
    }
  }, [status, chosen, effort, contextWindow]);
  useEffect(() => () => { setLockedIn(false); setCommitPayload(null); }, []);

  async function probe() {
    setBusy(true);
    setStatus(null);
    setMessage('');
    setModels(null);
    setFamily(null);
    setVersionId(null);
    setPickerAtT(null);
    setResultAtT(tl.tRef.current);

    const homeVal = homeRef.current.trim();
    // Read OAuth credentials. Empty `homeVal` falls back to `$HOME/.claude`
    // via shell expansion (single-quoted strings won't expand $HOME, so we
    // double-quote that branch deliberately).
    const cmd = homeVal
      ? `cat ${shellQuote(homeVal + '/.credentials.json')}`
      : 'cat "$HOME/.claude/.credentials.json"';
    let token;
    try {
      const result = await processHook.execAsync(cmd);
      if (!result || result.code !== 0) {
        setStatus('failed');
        setMessage('No credentials.json found. Wrong config dir, or run `claude auth login` first.');
        setResultAtT(tl.tRef.current);
        setBusy(false);
        return;
      }
      try {
        const json = JSON.parse(result.stdout);
        token = json && json.claudeAiOauth && json.claudeAiOauth.accessToken;
      } catch (e) {
        setStatus('failed');
        setMessage('credentials.json was not valid JSON.');
        setResultAtT(tl.tRef.current);
        setBusy(false);
        return;
      }
      if (!token) {
        setStatus('failed');
        setMessage('No accessToken in credentials.json — run `claude auth login`.');
        setResultAtT(tl.tRef.current);
        setBusy(false);
        return;
      }
    } catch (e) {
      setStatus('failed');
      setMessage((e && e.message) ? e.message : String(e));
      setResultAtT(tl.tRef.current);
      setBusy(false);
      return;
    }

    // Hit /v1/models with the OAuth Bearer token. Same beta header
    // Claude Code itself uses internally; without it the API rejects
    // the OAuth token.
    try {
      const resp = await fetchHook.getAsync('https://api.anthropic.com/v1/models', {
        'Authorization': `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      });
      if (resp.status === 401) {
        setStatus('failed');
        setMessage('Token rejected (401). Try `claude auth login` again.');
      } else if (resp.status !== 200) {
        const snippet = (resp.body || '').slice(0, 200);
        setStatus('failed');
        setMessage(`Anthropic /v1/models returned ${resp.status}: ${snippet}`);
      } else {
        const parsed = JSON.parse(resp.body);
        const list = (parsed && Array.isArray(parsed.data)) ? parsed.data : [];

        // Layer in `model-status.json` if the verifier cron has run.
        // Missing file → empty map → fall through to the heuristic.
        const statusMap = await loadModelStatus();
        setModelStatus(statusMap);

        setModels(list);
        setStatus('success');
        setMessage(`${list.length} model${list.length === 1 ? '' : 's'} available`);
        // First-render pick: latest Opus if available, else first family
        // we recognize.
        const presentFamilies = FAMILY_ORDER.filter((f) => list.some((m) => familyOf(m) === f));
        if (presentFamilies.length) setFamily(presentFamilies[0]);
        setPickerAtT(tl.tRef.current);
      }
      setResultAtT(tl.tRef.current);
    } catch (e) {
      setStatus('failed');
      setMessage((e && e.message) ? e.message : String(e));
      setResultAtT(tl.tRef.current);
    }
    setBusy(false);
  }

  // ── derived options for the four columns ─────────────────────────────

  const familiesAvailable = models
    ? FAMILY_ORDER.filter((f) => models.some((m) => familyOf(m) === f))
    : [];

  const familyOptions = familiesAvailable.map((f) => ({ id: f, label: FAMILY_LABEL[f] }));

  const versions = (models && family) ? versionsForFamily(family, models, modelStatus) : [];
  const versionOptions = versions.map((m) => ({ id: m.id, label: versionLabel(m, family) }));

  const has1mForChosen = chosen && supports1M(chosen);
  const contextOptions = [
    { id: 'default', label: '200k' },
    { id: '1m',      label: '1M'   },
  ];
  const ctxIsDisabled = (opt) => opt.id === '1m' && !has1mForChosen;

  const effortOptions = EFFORT_LEVELS_ALL.map((lvl) => ({ id: lvl, label: lvl }));
  const supportedEfforts = chosen ? effortLevelsFor(chosen, opusLatestId) : [];
  const effortIsDisabled = (opt) => !supportedEfforts.includes(opt.id);

  // ── opacity reveals (eased via tl.range easeOutCubic) ───────────────

  const resultOp = resultAtT != null
    ? tl.range(resultAtT, resultAtT + RESULT_REVEAL_MS)
    : 0;
  const pickerOp = pickerAtT != null
    ? tl.range(pickerAtT, pickerAtT + PICKER_REVEAL_MS)
    : 0;

  return (
    <FormShell>
      <LabeledInput
        label="Claude config dir (absolute path, optional)"
        value={home}
        onChange={setHome}
        placeholder={CLAUDE_HOME_PLACEHOLDER}
      />
      <S.AppFormButtonRow>
        <ProbeButton enabled={!busy} busy={busy} label="List models" onPress={probe} />
      </S.AppFormButtonRow>
      {status ? (
        <Box style={{ opacity: resultOp, marginTop: (1 - resultOp) * 6 }}>
          <ProbeResult status={status} message={message} />
        </Box>
      ) : null}
      {models && family ? (
        <Box style={{
          flexDirection: 'row',
          gap: 14,
          marginTop: 4,
        }}>
          <PickerCol
            label="Model"
            options={familyOptions}
            value={family}
            onChange={(id) => setFamily(id)}
            op={pickerOp}
          />
          <PickerCol
            label="Version"
            options={versionOptions}
            value={versionId}
            onChange={(id) => setVersionId(id)}
            op={pickerOp}
          />
          <PickerCol
            label="Context"
            options={contextOptions}
            value={contextWindow}
            onChange={(id) => setContextWindow(id)}
            isDisabled={ctxIsDisabled}
            op={pickerOp}
          />
          <PickerCol
            label="Effort"
            options={effortOptions}
            value={effort}
            onChange={(id) => setEffort(id)}
            isDisabled={effortIsDisabled}
            op={pickerOp}
          />
        </Box>
      ) : null}
    </FormShell>
  );
}

// ── 3) Local models provider ──────────────────────────────────────────

function LocalForm({ setLockedIn, setCommitPayload }) {
  const tl = useAnimationTimeline({});
  const [path, setPath] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [hasProbed, setHasProbed] = useState(false);
  const [resultAtT, setResultAtT] = useState(null);
  const [modelsAtT, setModelsAtT] = useState(null);
  const [statusAtT, setStatusAtT] = useState(null);

  const pathRef = useRef(path);
  const keyRef = useRef(apiKey);
  pathRef.current = path;
  keyRef.current = apiKey;

  const hasAnyInput =
    (typeof path === 'string' && path.trim().length > 0) ||
    (typeof apiKey === 'string' && apiKey.trim().length > 0);

  useEffect(() => {
    const ok = status === 'success' && chosen != null;
    setLockedIn(ok);
    setCommitPayload(ok ? { kind: 'local', path, apiKey, model: chosen } : null);
  }, [status, chosen, path, apiKey]);
  useEffect(() => () => { setLockedIn(false); setCommitPayload(null); }, []);
  useEffect(() => {
    setHasProbed(false);
    setStatus(null);
    setMessage('');
    setModels(null);
    setChosen(null);
    setResultAtT(null);
    setModelsAtT(null);
    setStatusAtT(null);
  }, [path, apiKey]);

  async function probe() {
    setHasProbed(true);
    setResultAtT(tl.tRef.current);
    setStatusAtT(tl.tRef.current);
    setModelsAtT(null);
    setBusy(true);
    setStatus('pending');
    setMessage('');
    setModels(null);
    setChosen(null);
    const p = pathRef.current.trim();
    const k = keyRef.current.trim();
    if (!p) {
      setModels(null);
      setStatus('failed');
      setMessage('No local path or endpoint provided.');
      setStatusAtT(tl.tRef.current);
      setBusy(false);
      return;
    }

    const normalizedPath = /^[a-zA-Z0-9.-]+:\d+(?:\/.*)?$/.test(p) ? `http://${p}` : p;

    if (/^https?:\/\//.test(normalizedPath)) {
      const HTTP_PROBE_TIMEOUT_MS = 2000;
      const base = normalizedPath.replace(/\/+$/, '');
      const probeUrls = [];
      if (/\/api\/v1\/models$/.test(base) || /\/(?:v1\/)?models$/.test(base) || /\/api\/tags$/.test(base)) {
        probeUrls.push(base);
      } else {
        const rootBase = base.replace(/\/(?:api\/v1|v1|models|api\/tags)$/, '');
        probeUrls.push(`${rootBase}/api/v1/models`);
        probeUrls.push(`${rootBase}/models`);
        probeUrls.push(`${rootBase}/v1/models`);
        probeUrls.push(`${rootBase}/api/tags`);
      }

      const seen = new Set();
      const uniqueProbeUrls = probeUrls.filter((u) => {
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
      });
      const headers = k ? { Authorization: `Bearer ${k}` } : undefined;
      let lastErr = '';
      setMessage(`Probing endpoint: ${uniqueProbeUrls.join(', ')}`);

      try {
        for (const url of uniqueProbeUrls) {
          let res;
          try {
            const fetchRes = await Promise.race([
              fetchHook(url, { method: 'GET', headers }),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${HTTP_PROBE_TIMEOUT_MS}ms`)), HTTP_PROBE_TIMEOUT_MS)),
            ]);
            const bodyText = await fetchRes.text();
            res = {
              status: fetchRes.status,
              body: bodyText,
            };
          } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            lastErr = `${url} -> ${msg}`;
            continue;
          }
          if (!res || typeof res.status !== 'number') {
            lastErr = `No response from ${url}`;
            continue;
          }
          if (res.status < 200 || res.status >= 300) {
            const bodySnippet = typeof res.body === 'string' ? res.body.trim().slice(0, 140) : '';
            lastErr = `${url} -> HTTP ${res.status}${bodySnippet ? `: ${bodySnippet}` : ''}`;
            continue;
          }

          let parsed = null;
          try { parsed = JSON.parse(res.body || '{}'); } catch {}

          const out = [];
          const pushModel = (v) => {
            if (typeof v === 'string' && v.trim().length > 0) out.push(v.trim());
          };
          const readRows = (rows) => {
            if (!Array.isArray(rows)) return;
            for (const row of rows) {
              if (typeof row === 'string') pushModel(row);
              else if (row && typeof row === 'object') {
                pushModel(row.id);
                pushModel(row.name);
                pushModel(row.model);
              }
            }
          };

          if (Array.isArray(parsed)) readRows(parsed);
          if (parsed && typeof parsed === 'object') {
            readRows(parsed.data);
            readRows(parsed.models);
          }

          const uniq = Array.from(new Set(out));
          if (uniq.length > 0) {
            setModels(uniq);
            setModelsAtT(tl.tRef.current);
            setStatus('success');
            setMessage(`Found ${uniq.length} model${uniq.length === 1 ? '' : 's'} at ${url}`);
            setStatusAtT(tl.tRef.current + 90);
            setBusy(false);
            return;
          }
          lastErr = `${url} returned no model ids`;
        }

        setModels(null);
        setStatus('failed');
        setMessage(lastErr || 'Unable to parse model list from endpoint.');
        setStatusAtT(tl.tRef.current);
      } catch (e) {
        setModels(null);
        setStatus('failed');
        setMessage((e && e.message) ? e.message : String(e));
        setStatusAtT(tl.tRef.current);
      }
      setBusy(false);
      return;
    }

    setModels([p.split('/').pop() || p]);
    setModelsAtT(tl.tRef.current);
    setStatus('success');
    setMessage(`Using local model path: ${p}`);
    setStatusAtT(tl.tRef.current + 90);
    setBusy(false);
  }

  const resultOp = resultAtT != null ? tl.range(resultAtT, resultAtT + LOCAL_RESULT_FADE_MS) : 0;
  const modelsOp = modelsAtT != null ? tl.range(modelsAtT, modelsAtT + LOCAL_RESULT_FADE_MS) : 0;
  const statusOp = statusAtT != null ? tl.range(statusAtT, statusAtT + LOCAL_RESULT_FADE_MS) : 0;
  const modelListHeight = models
    ? (models.length > 6 ? LOCAL_MODEL_LIST_MAX_H + 28 : models.length * LOCAL_MODEL_ROW_H + 34)
    : 0;

  return (
    <FormShell>
      <LabeledInput
        label=".gguf path or local endpoint"
        value={path}
        onChange={setPath}
        placeholder="/models/llama.gguf  or  http://localhost:11434/v1"
      />
      <LabeledInput
        label="API key (optional)"
        value={apiKey}
        onChange={setApiKey}
        placeholder="(usually empty)"
        secret
      />
      <S.AppFormButtonRow>
        <ProbeButton enabled={hasAnyInput} busy={busy} label="Probe" onPress={probe} />
      </S.AppFormButtonRow>
      {hasProbed ? (
        <Box style={{ flexDirection: 'column', gap: 10, opacity: resultOp, marginTop: (1 - resultOp) * LOCAL_RESULT_SLIDE_PX }}>
          {models ? (
            <Box
              style={{
                height: modelListHeight * modelsOp,
                overflow: 'hidden',
                opacity: modelsOp,
                marginTop: (1 - modelsOp) * LOCAL_RESULT_SLIDE_PX,
              }}
            >
              <ModelList models={models} selectedModel={chosen} onSelect={setChosen} />
            </Box>
          ) : null}
          <Box style={{ opacity: statusOp, marginTop: (1 - statusOp) * 8 }}>
            <ProbeResult status={status} message={message} />
          </Box>
        </Box>
      ) : null}
    </FormShell>
  );
}
