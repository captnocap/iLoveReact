// CodeEditor — the textual surface for the composition.
//
// Uses the host TextEditor primitive's `colorRows` + `paintText` mode
// so the source is syntax-tokenized inline. Tokenizer lives in
// ../highlight.ts; project sample ids are folded into it so they pick
// up the synth color.
//
// In-editor hover annotations:
//   - The TextEditor sits inside a Box that captures its on-screen rect
//     (onLayout) plus enter/exit hover edges.
//   - While the mouse is inside that Box, we poll getMouseX/getMouseY
//     (~60ms — same pattern Tooltip's cursor-anchor mode uses) and map
//     the pointer position to a (line, col), then tokenize the line to
//     find the identifier under the pointer.
//   - If the identifier is a known sandbox builtin / synth / library
//     sample, we set state to drive a positioned Tooltip anchored at the
//     cursor. Anything else (whitespace, punctuation, plain text, raw
//     numbers) clears the hover state and the tooltip hides.
//
// Ctrl+S still triggers compile via the global IFTTT binding in
// state.ts. Errors from the last compile render as a red gutter line
// below the editor.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Col, Row, Box, Text, TextEditor } from '@reactjit/runtime/primitives';
import { Tooltip } from '@reactjit/runtime/tooltip/Tooltip';
import { COLORS } from '../theme';
import { tokenizeLine, tokenizeToColorRows, type Token } from '../highlight';
import { findApiEntry, type ApiEntry } from '../api-cheatsheet';
import type { SampleRef } from '../domain';
import type { ComposerState } from '../state';

interface Props {
  s: ComposerState;
}

interface EditorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type HoverTarget =
  | { kind: 'api'; entry: ApiEntry }
  | { kind: 'sample'; sample: SampleRef };

// Hover poll cadence. 60ms is "fast enough that the cursor feels live"
// without re-rendering at every animation frame. Tooltip's cursor-anchor
// mode polls at 16ms; we're cheaper because we don't reposition the
// tooltip ourselves (the framework anchors it to the cursor).
const HOVER_POLL_MS = 60;

// Monospace character width is ~0.6× font size for typical fonts. This
// is an approximation — the framework's actual char width may differ
// slightly. Off-by-one on identifier boundaries is acceptable for v1;
// the tooltip just clears if the cursor lands in whitespace anyway.
const CHAR_WIDTH_RATIO = 0.6;

// Padding inside the TextEditor — keep in sync with the style block below.
const PAD_LEFT = 14;
const PAD_TOP = 12;

export function CodeEditor({ s }: Props) {
  const err = s.lastCompile && !s.lastCompile.ok ? s.lastCompile.error : null;

  // Build the set of project-defined sample ids so the tokenizer can
  // give them the synth color (rather than letting them fall through
  // to plain text). Memoized — the source re-tokenizes on every edit,
  // but the id set only changes when the library does.
  const sampleIds = useMemo(
    () => new Set(s.samples.map((sample) => sample.id)),
    [s.samples],
  );

  const colorRows = useMemo(
    () => tokenizeToColorRows(s.source, sampleIds),
    [s.source, sampleIds],
  );

  const [hovering, setHovering] = useState(false);
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const rectRef = useRef<EditorRect | null>(null);
  // Mirror state into refs so the polling loop can read latest values
  // without re-subscribing on every keystroke.
  const sourceRef = useRef(s.source); sourceRef.current = s.source;
  const samplesRef = useRef(s.samples); samplesRef.current = s.samples;
  const sampleIdsRef = useRef(sampleIds); sampleIdsRef.current = sampleIds;

  const fontSize = s.uiPrefs.fontSize;
  const lineHeight = fontSize + 6;
  const charWidth = fontSize * CHAR_WIDTH_RATIO;

  // Poll the mouse position while the editor is hovered. Compute (line,
  // col), find the token at that position, look up its help, set or
  // clear the tooltip target. Bailing out on any miss is intentional —
  // hovering whitespace should hide the tooltip immediately.
  useEffect(() => {
    if (!hovering) {
      setTarget(null);
      return;
    }
    const G: any = globalThis as any;
    let prevKey = ''; // dedupe — only setTarget when the resolved token changes

    const tick = () => {
      const rect = rectRef.current;
      if (!rect) return;
      const mx = typeof G.getMouseX === 'function' ? Number(G.getMouseX()) : 0;
      const my = typeof G.getMouseY === 'function' ? Number(G.getMouseY()) : 0;

      const localX = mx - rect.x - PAD_LEFT;
      const localY = my - rect.y - PAD_TOP;
      if (localX < 0 || localY < 0) {
        if (prevKey !== '') { prevKey = ''; setTarget(null); }
        return;
      }

      const lineIdx = Math.floor(localY / lineHeight);
      const colIdx = Math.floor(localX / charWidth);
      const lines = sourceRef.current.split('\n');
      if (lineIdx >= lines.length) {
        if (prevKey !== '') { prevKey = ''; setTarget(null); }
        return;
      }

      // Walk this line's tokens until we find the one that contains colIdx.
      const tokens: Token[] = tokenizeLine(lines[lineIdx], sampleIdsRef.current);
      let cursor = 0;
      let hit: Token | null = null;
      for (const tok of tokens) {
        const end = cursor + tok.text.length;
        if (colIdx >= cursor && colIdx < end) { hit = tok; break; }
        cursor = end;
      }
      if (!hit) {
        if (prevKey !== '') { prevKey = ''; setTarget(null); }
        return;
      }

      const next = resolveHover(hit, samplesRef.current);
      const nextKey = next ? hoverKey(next) : '';
      if (nextKey !== prevKey) {
        prevKey = nextKey;
        setTarget(next);
      }
    };

    tick();
    const id = setInterval(tick, HOVER_POLL_MS);
    return () => clearInterval(id);
  }, [hovering, lineHeight, charWidth]);

  return (
    <Col style={{
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: COLORS.editor,
    }}>
      <Box
        onLayout={(r: any) => {
          // onLayout gives us the wrapper's window-relative position +
          // size. Stash on a ref because the polling loop reads it
          // synchronously — no need to trigger a re-render on layout.
          rectRef.current = {
            x: Number(r?.x ?? 0),
            y: Number(r?.y ?? 0),
            width: Number(r?.width ?? 0),
            height: Number(r?.height ?? 0),
          };
        }}
        onHoverEnter={() => setHovering(true)}
        onHoverExit={() => setHovering(false)}
        style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}
      >
        <TextEditor
          value={s.source}
          onChange={(v: string) => s.setSource(v)}
          paintText={true}
          colorRows={colorRows}
          fontSize={s.uiPrefs.fontSize}
          color={COLORS.tokText}
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.editor,
            fontFamily: 'monospace',
            paddingLeft: PAD_LEFT,
            paddingRight: 14,
            paddingTop: PAD_TOP,
            paddingBottom: 12,
            borderWidth: 0,
            lineHeight,
            tabWidth: 2,
          }}
        />
      </Box>

      <Tooltip
        visible={!!target}
        variant="sweatshop-ui"
        anchor={{ kind: 'cursor', offsetX: 14, offsetY: 14 }}
        title={target ? hoverTitle(target) : ''}
        label={target ? hoverLabel(target) : ''}
        rows={target ? hoverRows(target) : undefined}
      />

      {err ? (
        <Row style={{
          backgroundColor: COLORS.bad,
          paddingLeft: 14,
          paddingRight: 14,
          paddingTop: 6,
          paddingBottom: 6,
          alignItems: 'center',
          gap: 8,
        }}>
          <Text style={{ color: COLORS.bg, fontSize: 11, fontWeight: '700' }}>ERROR</Text>
          <Text style={{ color: COLORS.bg, fontSize: 12, fontFamily: 'monospace', flexGrow: 1 }}>
            {err}
          </Text>
        </Row>
      ) : null}
    </Col>
  );
}

// ── Hover resolution ────────────────────────────────────────────────

function resolveHover(tok: Token, samples: SampleRef[]): HoverTarget | null {
  if (tok.kind === 'builtin' || tok.kind === 'synth') {
    const entry = findApiEntry(tok.text);
    return entry ? { kind: 'api', entry } : null;
  }
  if (tok.kind === 'sample') {
    const sample = samples.find((s) => s.id === tok.text);
    return sample ? { kind: 'sample', sample } : null;
  }
  return null;
}

function hoverKey(t: HoverTarget): string {
  return t.kind === 'api' ? `api:${t.entry.name}` : `sample:${t.sample.id}`;
}

function hoverTitle(t: HoverTarget): string {
  return t.kind === 'api' ? t.entry.signature : t.sample.id;
}

function hoverLabel(t: HoverTarget): string {
  if (t.kind === 'api') return t.entry.description;
  const origin = t.sample.source === 'captured' ? 'Captured sample' : 'Imported sample';
  return `${origin} · ${t.sample.path}`;
}

function hoverRows(t: HoverTarget) {
  if (t.kind === 'api') {
    return [{ label: 'example', value: t.entry.example }];
  }
  return [{ label: 'usage', value: `makeBeat(${t.sample.id}, 0, 1, '0-0-0-0-')` }];
}
