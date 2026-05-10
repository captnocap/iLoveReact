import { useState } from 'react';
import { Box, Col, ScrollView } from '@reactjit/runtime/primitives';
import { MessageBlock, type TranscriptBlock } from './MessageBlocks';
import { SignalPopoverLayer } from './SignalPopoverLayer';
import type { SignalHighlightProps } from './TripwireMenu';
import { CHAT_CARD } from './tokens';

const TRANSCRIPT_SCROLL_HEIGHT = 320;

function estimateBlockHeight(block: TranscriptBlock): number {
  if (block.kind === 'user') return 18 + block.lines.length * 15;
  if (block.kind === 'agent') return 22 + block.lines.length * (block.markable ? 17 : 15);
  if (block.kind === 'thinking') return 22 + block.lines.length * 15;
  if (block.kind === 'tool') return 54;
  return 28 + block.lines.length * 17;
}

function estimateTranscriptHeight(blocks: TranscriptBlock[]): number {
  if (blocks.length === 0) return 22;
  const bodyHeight = blocks.reduce((total, block) => total + estimateBlockHeight(block), 0);
  const connectorHeight = Math.max(0, blocks.length - 1) * 10;
  return 22 + bodyHeight + connectorHeight;
}

export function ConsoleTranscript({ blocks, attachment }: { blocks: TranscriptBlock[]; attachment?: any }) {
  const [openSignal, setOpenSignal] = useState<SignalHighlightProps | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 384, height: 300 });
  const estimatedHeight = estimateTranscriptHeight(blocks);
  const shouldScroll = estimatedHeight > TRANSCRIPT_SCROLL_HEIGHT;

  const toggleSignal = (signal: SignalHighlightProps) => {
    setOpenSignal((current) => (current?.id === signal.id ? null : signal));
  };

  return (
    <Col
      style={{
        position: 'relative',
        width: '100%',
        backgroundColor: CHAT_CARD.panel,
        borderWidth: 1,
        borderColor: CHAT_CARD.borderSoft,
        borderRadius: 4,
        overflow: 'visible',
      }}
      onLayout={(rect: any) => {
        if (!rect) return;
        const next = {
          x: Number.isFinite(rect.x) ? rect.x : 0,
          y: Number.isFinite(rect.y) ? rect.y : 0,
          width: Number.isFinite(rect.width) ? rect.width : 384,
          height: Number.isFinite(rect.height) ? rect.height : 300,
        };
        // Diff before setState — onLayout fires every layout pass and a
        // bare setViewport(next) writes a fresh object every tick, which
        // re-renders, re-lays out, fires onLayout again, … parent's
        // reconciler then ships an UPDATE for every ConsoleTranscript
        // every frame and the child window rebuilds non-stop.
        setViewport((prev) => (
          prev.x === next.x && prev.y === next.y &&
          prev.width === next.width && prev.height === next.height
            ? prev
            : next
        ));
      }}
    >
      {shouldScroll ? (
        <ScrollView
          style={{ width: '100%', height: TRANSCRIPT_SCROLL_HEIGHT, padding: 11 }}
          showScrollbar={false}
          onScroll={(payload: any) => {
            if (Number.isFinite(payload?.scrollY) && openSignal) setOpenSignal(null);
          }}
        >
          <Col style={{ gap: 0 }}>
            {blocks.map((block, index) => (
              <MessageBlock
                key={`${block.kind}-${index}`}
                block={block}
                openSignalId={openSignal?.id ?? null}
                onToggleSignal={toggleSignal}
                connectTop={index > 0}
                showConnector={index < blocks.length - 1}
              />
            ))}
          </Col>
        </ScrollView>
      ) : (
        <Col style={{ width: '100%', padding: 11, gap: 0 }}>
          {blocks.map((block, index) => (
            <MessageBlock
              key={`${block.kind}-${index}`}
              block={block}
              openSignalId={openSignal?.id ?? null}
              onToggleSignal={toggleSignal}
              connectTop={index > 0}
              showConnector={index < blocks.length - 1}
            />
          ))}
        </Col>
      )}
      {attachment ? (
        <Box
          style={{
            borderTopWidth: 1,
            borderColor: 'theme:rule',
            backgroundColor: CHAT_CARD.panelDeep,
          }}
        >
          {attachment}
        </Box>
      ) : null}
      {openSignal ? <SignalPopoverLayer anchor={openSignal.anchor} selected={openSignal.selected} viewport={viewport} /> : null}
    </Col>
  );
}
