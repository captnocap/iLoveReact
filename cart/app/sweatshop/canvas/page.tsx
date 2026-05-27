// Canvas — the IF/THEN composer (replaces the node-editing canvas).
//
// ─────────────────────────────────────────────────────────────────────
// WHY THIS SHAPE
//
//   Flow-graph editors are everywhere and none have won, because they
//   ask a human to author a DETERMINISTIC path for a NON-deterministic
//   model. The one thing that genuinely IS deterministic is the IFTTT
//   seam: a concrete trigger fires a concrete action — the whole runtime
//   already compiles to one primitive:
//
//       useIFTTT(trigger, action)   ===   IF trigger THEN action
//
//   Two multiline prompt boxes — IF and THEN. On submit, the assistant
//   is handed the FULL capability range for that side plus the user's
//   intent, and writes back a stack of <option> tags (just text — see
//   compose/suggest.ts). We parse them into a column of choices under
//   the box. There is always an "other" option for clarification: it
//   clears the choices so the user can refine the prompt and resubmit.
//
//   Picking one option per side is the eventual commitment that compiles
//   to the useIFTTT recipe (compose/graph.ts) — the graph reveal + save
//   are the next step; for now we land the choice generation.
// ─────────────────────────────────────────────────────────────────────

import { useRef, useState } from 'react';
import { Col, Input, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useAssistantChat } from '../../chat/useAssistantChat';
import { useCRUD } from '../../db';
import { suggestOptions, OTHER_ID, type Suggestion } from './compose/suggest';
import { buildConfig, type IfThenConfig } from './compose/types';
import { saveConfigFile } from './compose/config-store';
import type { Side } from './compose/catalog';

// useCRUD wants a Schema<T> with .parse(); the config is already validated by
// construction, so pass it through unchanged.
const passthrough: any = { parse: (v: unknown) => v };

const LETTER_SIZE = 72;
const BOX_W = 420;

// One generated choice. Shows the plain-language label; for real
// capabilities it also shows the grounded token underneath (behind the
// curtain). "other" is styled as a quieter escape hatch.
function OptionCard({
  opt,
  accent,
  selected,
  onPress,
}: {
  opt: Suggestion;
  accent: string;
  selected: boolean;
  onPress: () => void;
}) {
  const isOther = opt.id === OTHER_ID;
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'column',
        gap: 3,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 10,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? accent : 'theme:rule',
        backgroundColor: isOther ? 'theme:bg' : selected ? 'theme:bg1' : 'theme:bg2',
      }}
    >
      <S.Body>{opt.text}</S.Body>
      {!isOther ? <S.MicroDim>{opt.capability.join('  →  ')}</S.MicroDim> : null}
    </Pressable>
  );
}

function SideColumn({
  letter,
  accent,
  text,
  onChange,
  onSubmit,
  busy,
  options,
  selectedId,
  onSelect,
}: {
  letter: string;
  accent: string;
  text: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  options: Suggestion[];
  selectedId: string | null;
  onSelect: (o: Suggestion) => void;
}) {
  return (
    <Row style={{ alignItems: 'flex-start', gap: 16 }}>
      <Text size={LETTER_SIZE} bold color={accent}>{letter}</Text>
      <Col style={{ width: BOX_W, gap: 10 }}>
        <Input
          type="multiline"
          text={text}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder=""
          style={{
            width: BOX_W,
            minHeight: 160,
            borderWidth: 2,
            borderColor: accent,
            borderRadius: 14,
            backgroundColor: 'theme:bg2',
            color: 'theme:ink',
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 20,
            paddingRight: 20,
            fontSize: 22,
          }}
        />
        {busy ? (
          <S.Caption>thinking…</S.Caption>
        ) : (
          options.map((o) => (
            <OptionCard
              key={o.id}
              opt={o}
              accent={accent}
              selected={selectedId === o.id}
              onPress={() => onSelect(o)}
            />
          ))
        )}
      </Col>
    </Row>
  );
}

export default function CanvasPage() {
  const { ask } = useAssistantChat();
  const configs = useCRUD<IfThenConfig>('if-then-config', passthrough);

  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [ifText, setIfText] = useState('');
  const [thenText, setThenText] = useState('');
  const [ifOpts, setIfOpts] = useState<Suggestion[]>([]);
  const [thenOpts, setThenOpts] = useState<Suggestion[]>([]);
  const [ifSel, setIfSel] = useState<string | null>(null);
  const [thenSel, setThenSel] = useState<string | null>(null);
  const [ifBusy, setIfBusy] = useState(false);
  const [thenBusy, setThenBusy] = useState(false);

  // Serialize asks — useAssistantChat rejects a second ask while one is in
  // flight, so chain them through a single queue.
  const askQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const queuedAsk = (t: string): Promise<string> => {
    const run = askQueueRef.current.then(() => ask(t));
    askQueueRef.current = run.catch(() => undefined);
    return run as Promise<string>;
  };

  const runSuggest = async (side: Side) => {
    const intent = side === 'if' ? ifText : thenText;
    if (!intent.trim()) return;
    if (side === 'if') { setIfBusy(true); setIfSel(null); }
    else { setThenBusy(true); setThenSel(null); }
    const opts = await suggestOptions(side, intent, queuedAsk);
    if (side === 'if') { setIfOpts(opts); setIfBusy(false); }
    else { setThenOpts(opts); setThenBusy(false); }
  };

  const onSelect = (side: Side, o: Suggestion) => {
    if (o.id === OTHER_ID) {
      // Clarification: drop the choices so the user can refine the prompt
      // (the text is still in the box) and submit again for a fresh set.
      if (side === 'if') { setIfOpts([]); setIfSel(null); }
      else { setThenOpts([]); setThenSel(null); }
      return;
    }
    if (side === 'if') setIfSel(o.id);
    else setThenSel(o.id);
  };

  // Persist the picked IF + THEN as one configuration: to disk (durable) AND
  // as a DB row (entity if-then-config, bucket user-sweatshop). The on-disk
  // file is the source of truth; the DB is throwaway/derivable, so a DB
  // failure must not lose the save.
  const onSave = async () => {
    if (!ifSel || !thenSel) return;
    const ifOpt = ifOpts.find((o) => o.id === ifSel);
    const thenOpt = thenOpts.find((o) => o.id === thenSel);
    if (!ifOpt || !thenOpt) return;
    const config = buildConfig(ifOpt, thenOpt);
    const fileOk = saveConfigFile(config);
    let dbOk = false;
    try {
      await configs.create(config);
      dbOk = true;
    } catch {
      // DB is throwaway; the file is the durable copy. The if_then_config
      // table is created by bootstrap on the next app start, so db may read
      // ✗ until then — the file save still holds.
    }
    setSavedFlash(`Saved ${config.id} — file ${fileOk ? '✓' : '✗'} · db ${dbOk ? '✓' : '✗'}`);
  };

  const canSave = !!(ifSel && thenSel);

  return (
    <S.Page>
      <Col
        style={{
          width: '100%',
          height: '100%',
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: 48,
          paddingRight: 48,
        }}
      >
        <Row style={{ alignItems: 'flex-start', gap: 48 }}>
          <SideColumn
            letter="IF"
            accent="theme:accentHot"
            text={ifText}
            onChange={setIfText}
            onSubmit={() => runSuggest('if')}
            busy={ifBusy}
            options={ifOpts}
            selectedId={ifSel}
            onSelect={(o) => onSelect('if', o)}
          />
          <SideColumn
            letter="THEN"
            accent="theme:accent"
            text={thenText}
            onChange={setThenText}
            onSubmit={() => runSuggest('then')}
            busy={thenBusy}
            options={thenOpts}
            selectedId={thenSel}
            onSelect={(o) => onSelect('then', o)}
          />
        </Row>

        {/* Minimal save trigger — the index UI comes later; this just makes
            sure a picked IF+THEN actually persists (file + DB). */}
        {canSave ? (
          <Pressable
            onPress={onSave}
            style={{
              marginTop: 28,
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 28,
              paddingRight: 28,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: 'theme:rule',
              backgroundColor: 'theme:bg1',
            }}
          >
            <S.Body>Save configuration</S.Body>
          </Pressable>
        ) : null}
        {savedFlash ? (
          <Col style={{ marginTop: 10 }}>
            <S.Caption>{savedFlash}</S.Caption>
          </Col>
        ) : null}
      </Col>
    </S.Page>
  );
}
