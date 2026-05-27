import { useMemo, useState, memo } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import type { TurnDiffSummary, TurnId, DiffStat } from '../types';

// ── helpers ────────────────────────────────────────────────────────────────

function summarizeDiffStat(
  files: { path: string; stat: DiffStat }[],
): { added: number; removed: number; modified: number } {
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const f of files) {
    added += f.stat.added;
    removed += f.stat.removed;
    modified += f.stat.modified;
  }
  return { added, removed, modified };
}

function hasNonZeroStat(stat: { added: number; removed: number; modified: number }): boolean {
  return stat.added !== 0 || stat.removed !== 0 || stat.modified !== 0;
}

// ── diff stat label ────────────────────────────────────────────────────────

const DiffStatLabel = memo(function DiffStatLabel({
  stat,
}: {
  stat: { added: number; removed: number; modified: number };
}) {
  const parts: string[] = [];
  if (stat.added) parts.push(`+${stat.added}`);
  if (stat.removed) parts.push(`-${stat.removed}`);
  if (stat.modified) parts.push(`~${stat.modified}`);
  if (parts.length === 0) return null;
  return (
    <Text fontSize={10} color="#666">
      {parts.join(' ')}
    </Text>
  );
});

// ── file diff row ──────────────────────────────────────────────────────────

const FileDiffRow = memo(function FileDiffRow({
  file,
  onPress,
}: {
  file: { path: string; stat: DiffStat };
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Row
        style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 4,
          backgroundColor: '#16161a',
        }}
      >
        <Text
          fontSize={12}
          color="#aaa"
          style={{
            flexShrink: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {file.path}
        </Text>
        <Row style={{ alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <DiffStatLabel stat={file.stat} />
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: '#2a2a30',
              borderRadius: 4,
            }}
          >
            <Text fontSize={10} color="#888">
              View
            </Text>
          </Box>
        </Row>
      </Row>
    </Pressable>
  );
});

// ── turn chip ──────────────────────────────────────────────────────────────

const TurnChip = memo(function TurnChip({
  turnCount,
  selected,
  onPress,
}: {
  turnCount: number;
  selected: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: selected ? '#555' : '#333',
          backgroundColor: selected ? '#2a2a30' : '#1a1a1e',
        }}
      >
        <Text fontSize={10} color={selected ? '#e8e8e8' : '#888'}>
          Turn {turnCount}
        </Text>
      </Box>
    </Pressable>
  );
});

// ── shell components (ported from DiffPanelShell.tsx) ──────────────────────

export type DiffPanelMode = 'inline' | 'sheet' | 'sidebar';

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const isInline = props.mode === 'inline';
  return (
    <Col
      style={{
        height: '100%',
        backgroundColor: '#0e0e10',
        width: isInline ? '42vw' : '100%',
        minWidth: isInline ? 360 : 0,
        maxWidth: isInline ? 560 : undefined,
        flexShrink: isInline ? 0 : undefined,
        borderLeftWidth: isInline ? 1 : 0,
        borderColor: '#1f1f23',
      }}
    >
      <Box
        style={{
          borderBottomWidth: 1,
          borderColor: '#1f1f23',
        }}
      >
        <Row
          style={{
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            minWidth: 0,
          }}
        >
          {props.header}
        </Row>
      </Box>
      {props.children}
    </Col>
  );
}

export function DiffPanelLoadingState({ label }: { label: string }) {
  return (
    <Col style={{ flexGrow: 1, padding: 8, gap: 8 }}>
      <Box
        style={{
          flexGrow: 1,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#2a2a30',
          backgroundColor: '#16161a',
          padding: 12,
          gap: 8,
        }}
      >
        <Row
          style={{
            alignItems: 'center',
            gap: 8,
            borderBottomWidth: 1,
            borderColor: '#2a2a30',
            paddingBottom: 8,
          }}
        >
          <Box
            style={{
              height: 10,
              width: 80,
              borderRadius: 5,
              backgroundColor: '#2a2a30',
            }}
          />
          <Box
            style={{
              height: 10,
              width: 40,
              borderRadius: 5,
              backgroundColor: '#2a2a30',
              marginLeft: 'auto',
            }}
          />
        </Row>
        <Col style={{ gap: 6, marginTop: 8 }}>
          <Box
            style={{
              height: 8,
              width: '100%',
              borderRadius: 4,
              backgroundColor: '#222226',
            }}
          />
          <Box
            style={{
              height: 8,
              width: '100%',
              borderRadius: 4,
              backgroundColor: '#222226',
            }}
          />
          <Box
            style={{
              height: 8,
              width: '90%',
              borderRadius: 4,
              backgroundColor: '#222226',
            }}
          />
          <Box
            style={{
              height: 8,
              width: '95%',
              borderRadius: 4,
              backgroundColor: '#222226',
            }}
          />
          <Box
            style={{
              height: 8,
              width: '85%',
              borderRadius: 4,
              backgroundColor: '#222226',
            }}
          />
        </Col>
        <Text fontSize={1} color="transparent">
          {label}
        </Text>
      </Box>
    </Col>
  );
}

// ── props ──────────────────────────────────────────────────────────────────

export interface DiffPanelProps {
  turnDiffSummaries: TurnDiffSummary[];
  selectedTurnId?: TurnId | null;
  onSelectTurn?: (turnId: TurnId) => void;
  onOpenFileDiff?: (turnId: TurnId, filePath: string) => void;
  mode?: DiffPanelMode;
}

// ── main component ─────────────────────────────────────────────────────────

export const DiffPanel = memo(function DiffPanel({
  turnDiffSummaries,
  selectedTurnId,
  onSelectTurn,
  onOpenFileDiff,
  mode = 'inline',
}: DiffPanelProps) {
  const [loading] = useState(false);

  const orderedSummaries = useMemo(
    () =>
      [...turnDiffSummaries].sort((a, b) => {
        return a.turnId.localeCompare(b.turnId);
      }),
    [turnDiffSummaries],
  );

  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : orderedSummaries.find((s) => s.turnId === selectedTurnId) ??
        orderedSummaries[0];

  const headerRow = (
    <Row
      style={{
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      {orderedSummaries.map((summary, idx) => (
        <TurnChip
          key={summary.turnId}
          turnCount={idx + 1}
          selected={summary.turnId === selectedTurn?.turnId}
          onPress={() => onSelectTurn?.(summary.turnId)}
        />
      ))}
      {orderedSummaries.length === 0 && (
        <Text fontSize={10} color="#555">
          No turns
        </Text>
      )}
    </Row>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {loading ? (
        <DiffPanelLoadingState label="Loading diff..." />
      ) : orderedSummaries.length === 0 ? (
        <Box
          style={{
            flexGrow: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 20,
          }}
        >
          <Text
            fontSize={12}
            color="#555"
            style={{ textAlign: 'center' }}
          >
            Select a thread to inspect turn diffs.
          </Text>
        </Box>
      ) : !selectedTurn || selectedTurn.files.length === 0 ? (
        <Box
          style={{
            flexGrow: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 20,
          }}
        >
          <Text
            fontSize={12}
            color="#555"
            style={{ textAlign: 'center' }}
          >
            No changes in this selection.
          </Text>
        </Box>
      ) : (
        <ScrollView showScrollbar style={{ flexGrow: 1, width: '100%' }}>
          <Col style={{ padding: 12, gap: 10 }}>
            {/* Summary bar */}
            <Row
              style={{
                alignItems: 'center',
                gap: 8,
                paddingBottom: 8,
                borderBottomWidth: 1,
                borderColor: '#1f1f23',
              }}
            >
              <Text fontSize={11} color="#888">
                Changed files ({selectedTurn.files.length})
              </Text>
              <Text fontSize={11} color="#666">
                •
              </Text>
              <DiffStatLabel stat={summarizeDiffStat(selectedTurn.files)} />
            </Row>

            {/* File list */}
            <Col style={{ gap: 6 }}>
              {selectedTurn.files.map((file) => (
                <FileDiffRow
                  key={file.path}
                  file={file}
                  onPress={() =>
                    onOpenFileDiff?.(selectedTurn.turnId, file.path)
                  }
                />
              ))}
            </Col>
          </Col>
        </ScrollView>
      )}
    </DiffPanelShell>
  );
});
