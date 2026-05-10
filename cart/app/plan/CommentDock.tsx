// CommentDock — bottom dock for staged @target comments.
//
// The InputStrip in the shell is the only text-entry surface. While a
// draft anchor is active, this dock IS the input target — typing in
// the bar stages a comment here. The `active` prop drives the
// accent-ring focus state so the user can see at a glance whether
// the next submit lands here or in the planning chat.

import { Box, Col, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import type { Comment } from './types';

interface Props {
  comments: Comment[];
  draftRef: string | null;
  draftRefLabel: string | null;
  /** True when this dock is the input target (i.e. an anchor is staged). */
  active: boolean;
  onCancelDraft: () => void;
  onRemoveComment: (id: string) => void;
  onClear: () => void;
  onSendBatch: () => void;
  sending: boolean;
}

function ActivePill() {
  return (
    <Row style={{
      alignItems: 'center', gap: 6,
      paddingTop: 4, paddingBottom: 4, paddingLeft: 10, paddingRight: 10,
      borderRadius: 999,
      backgroundColor: 'theme:accent',
    }}>
      <Box style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: 'theme:paper' }} />
      <Text size={12} bold color="theme:paper">ACTIVE INPUT</Text>
    </Row>
  );
}

export function CommentDock(props: Props) {
  const { comments, draftRef, draftRefLabel, active, onCancelDraft,
          onRemoveComment, onClear, onSendBatch, sending } = props;

  const queued = comments.filter((c) => c.status === 'queued');

  return (
    <Col style={{
      width: '100%',
      borderTopWidth: active ? 2 : 1,
      borderTopColor: active ? 'theme:accent' : 'theme:rule',
      borderLeftWidth: active ? 4 : 0,
      borderLeftColor: 'theme:accent',
      backgroundColor: active ? 'theme:bg' : 'theme:bg1',
      padding: 14,
      gap: 10,
    }}>
      <Row style={{ alignItems: 'center', gap: 10 }}>
        <Text size={16} bold color="theme:ink">Comments</Text>
        <Text size={14} color="theme:inkDim">
          {queued.length === 0 ? '— none staged' : `— ${queued.length} staged`}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        {active ? <ActivePill /> : null}
        <Pressable onPress={onClear} disabled={queued.length === 0}>
          <Text size={14} color={queued.length === 0 ? 'theme:inkDimmer' : 'theme:ink'}>Clear</Text>
        </Pressable>
        <Pressable
          onPress={onSendBatch}
          disabled={queued.length === 0 || sending}
          style={{
            paddingTop: 8, paddingBottom: 8, paddingLeft: 16, paddingRight: 16,
            borderRadius: 4,
            backgroundColor: queued.length === 0 || sending ? 'theme:bg2' : 'theme:accent',
          }}
        >
          <Text size={14} bold color={queued.length === 0 || sending ? 'theme:inkDimmer' : 'theme:paper'}>
            {sending
              ? 'Submitting…'
              : queued.length > 0
                ? `Submit ${queued.length} comment${queued.length === 1 ? '' : 's'} to planner`
                : 'Submit to planner'}
          </Text>
        </Pressable>
      </Row>

      {draftRef ? (
        <Row style={{
          gap: 10, alignItems: 'center',
          padding: 12, borderRadius: 6,
          borderWidth: 1, borderColor: 'theme:accent',
          backgroundColor: 'theme:bg2',
        }}>
          <Text size={12} bold color="theme:accent">@TARGET</Text>
          <Text size={15} bold color="theme:ink">{draftRefLabel || draftRef}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable
            onPress={onCancelDraft}
            style={{
              paddingTop: 6, paddingBottom: 6, paddingLeft: 12, paddingRight: 12,
              borderRadius: 4, borderWidth: 1, borderColor: 'theme:rule',
              backgroundColor: 'theme:bg1',
            }}
          >
            <Text size={13} color="theme:ink">Cancel target</Text>
          </Pressable>
        </Row>
      ) : null}

      {queued.length > 0 ? (
        <Col style={{ gap: 6 }}>
          {queued.map((c) => (
            <Row key={c.id} style={{ gap: 10, alignItems: 'flex-start' }}>
              <Box style={{
                paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8,
                borderRadius: 4, backgroundColor: 'theme:bg2',
              }}>
                <Text size={12} bold color="theme:inkDim">{c.refLabel}</Text>
              </Box>
              <Box style={{ flexGrow: 1 }}>
                <Text size={15} color="theme:ink" style={{ lineHeight: 22 }}>{c.body}</Text>
              </Box>
              <Pressable onPress={() => onRemoveComment(c.id)}>
                <Text size={16} color="theme:inkDim">×</Text>
              </Pressable>
            </Row>
          ))}
        </Col>
      ) : null}
    </Col>
  );
}
