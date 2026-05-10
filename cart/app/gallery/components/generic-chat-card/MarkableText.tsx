import { useState } from 'react';
import { Box, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { CHAT_CARD } from './tokens';
import type { SignalHighlightProps } from './TripwireMenu';

function normalizeWord(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

export function MarkableLine(props: {
  blockId: string;
  line: string;
  lineIndex: number;
  openSignalId?: string | null;
  onToggleSignal?: (signal: SignalHighlightProps) => void;
}) {
  const parts = props.line.split(/(\s+)/).filter((part) => part.length > 0);

  return (
    <Row style={{ alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      {parts.map((part, index) => {
        const isSpace = /^\s+$/.test(part);

        if (isSpace) {
          return (
            <Text key={`space-${props.lineIndex}-${index}`} style={{ fontFamily: 'monospace', fontSize: 10, color: CHAT_CARD.text }}>
              {part}
            </Text>
          );
        }

        const selected = normalizeWord(part) || part;
        return (
          <MarkableWord
            key={`word-${props.lineIndex}-${index}`}
            blockId={props.blockId}
            lineIndex={props.lineIndex}
            wordIndex={index}
            token={part}
            selected={selected}
            openSignalId={props.openSignalId}
            onToggleSignal={props.onToggleSignal}
          />
        );
      })}
    </Row>
  );
}

function MarkableWord(props: {
  blockId: string;
  lineIndex: number;
  wordIndex: number;
  token: string;
  selected: string;
  openSignalId?: string | null;
  onToggleSignal?: (signal: SignalHighlightProps) => void;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const signalId = `${props.blockId}:${props.lineIndex}:${props.wordIndex}:${props.selected}`;
  const isOpen = props.openSignalId === signalId;

  return (
    <Box style={{ position: 'relative', overflow: 'visible' }}>
      <Pressable
        onLayout={(rect: any) => {
          if (!rect) return;
          const next = {
            x: Number.isFinite(rect.x) ? rect.x : 0,
            y: Number.isFinite(rect.y) ? rect.y : 0,
            width: Number.isFinite(rect.width) ? rect.width : props.token.length * 6 + 4,
            height: Number.isFinite(rect.height) ? rect.height : 12,
          };
          // Diff before setState — onLayout fires on every layout pass
          // and an unconditional setAnchor writes a fresh object every
          // tick, which re-renders, re-lays out, fires onLayout again,
          // … the default transcript has many markable tokens per card
          // and the loop multiplies into a per-frame mutation flood.
          setAnchor((prev) => (
            prev &&
            prev.x === next.x && prev.y === next.y &&
            prev.width === next.width && prev.height === next.height
              ? prev
              : next
          ));
        }}
        onPress={() => {
          const nextAnchor = anchor ?? {
            x: 0,
            y: 0,
            width: props.token.length * 6 + 4,
            height: 12,
          };
          props.onToggleSignal?.({
            id: signalId,
            selected: props.selected,
            anchor: nextAnchor,
          });
        }}
        style={{
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: isOpen ? 'theme:bg2' : 'theme:transparent',
          borderWidth: 1,
          borderColor: isOpen ? 'theme:lilac' : 'theme:transparent',
          borderRadius: 2,
        }}
      >
        <Text style={{ fontFamily: 'monospace', fontSize: 10, color: isOpen ? 'theme:atch' : CHAT_CARD.text }}>{props.token}</Text>
      </Pressable>
    </Box>
  );
}
