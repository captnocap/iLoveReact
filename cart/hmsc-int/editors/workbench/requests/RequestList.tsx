// editors/workbench/requests/RequestList.tsx — the REQUEST stage: THE DETAIL
// (REQPANEL-0606 → REQBOARD-0607 → the master-detail SWAP). USER VERDICT,
// verbatim: "i would have thought you put the list of asks in the area where
// the request data is xD but maybe im wrong" — they were right. The list of
// asks now lives in the narrow column 3 (panel.ts requestsPanel); THIS wide
// area renders the SELECTED request's full data with room to breathe: meta
// header, the board verbs, THE ASK byte-verbatim (wrapped, scrollable), the
// resolution paragraph + shas, the events/notes history, and the user's
// COMMENT box (REQSEC-0607 addendum, verbatim: "leave comments on things so
// that it can be used as a place i can go through and say if it is correct
// or not" — appends a note as actor 'user' through the same noteRequest
// door; any state, even done). The SECRETARY strip rides on top. All data +
// verbs come from the headless requestDetail spec so the P4 suite covers
// them without React.

import { useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { C, accentFor } from '../../../shell/workbench.cls';
import { requestDetail, shortStamp } from './panel';
import { SecretaryBar } from './SecretaryBar';
import type { RequestsStore, RequestsView } from './store';

const MONO = 'monospace';

function toneFor(status: string): string {
  if (status === 'new') return accentFor('warning');
  if (status === 'doing') return accentFor('accent');
  if (status === 'review') return accentFor('info');
  return accentFor('success'); // done
}

export function RequestList(props: { store: RequestsStore; view: RequestsView }) {
  const { store } = props;
  const detail = requestDetail(store);
  const record = detail.record;
  const [comment, setComment] = useState('');

  const postComment = () => {
    const text = comment.trim();
    if (!text || !record) return;
    store.noteByUser(record.id, text); // the history below re-reads on notify
    setComment('');
  };

  return (
    <C.LogPane>
      <SecretaryBar store={store} />
      {!record ? (
        <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={11} color={accentFor('textFaint')} style={{ fontFamily: MONO }}>{detail.hint ?? ''}</Text>
        </Box>
      ) : (
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'column', gap: 12, padding: 14 }}>
            {/* meta header */}
            <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Text fontSize={13} color={accentFor('text')} style={{ fontFamily: MONO, fontWeight: 800 }}>{record.id}</Text>
              <Box style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 2, paddingBottom: 2, borderRadius: 4, backgroundColor: toneFor(record.status) }}>
                <Text fontSize={10} color={accentFor('bg')} style={{ fontFamily: MONO, fontWeight: 800 }}>{record.status}</Text>
              </Box>
              <Text fontSize={11} color={accentFor('textDim')} style={{ fontFamily: MONO }}>{`${detail.stamp} · ${record.origin}`}</Text>
              {(record.tags ?? []).map((tag) => (
                <Box key={tag} style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4, borderWidth: 1, borderColor: accentFor('controlBorder') }}>
                  <Text fontSize={10} color={accentFor('info')} style={{ fontFamily: MONO }}>{`#${tag}`}</Text>
                </Box>
              ))}
            </Box>

            {/* the board verbs (review→done stays user-gated; dispatches get none) */}
            {detail.verbs.length > 0 ? (
              <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {detail.verbs.map((verb) => (
                  <Pressable
                    key={verb.k}
                    onPress={() => verb.run()}
                    style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: accentFor(verb.tone), backgroundColor: accentFor('bgElevated') }}
                  >
                    <Text fontSize={11} color={accentFor(verb.tone)} style={{ fontFamily: MONO, fontWeight: 800 }}>{verb.k}</Text>
                  </Pressable>
                ))}
              </Box>
            ) : null}
            {detail.terminal ? (
              <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: MONO }}>{detail.terminal}</Text>
            ) : null}

            {/* THE ASK — byte-verbatim, wrapped, with room to breathe */}
            <Box style={{ flexDirection: 'column', gap: 4 }}>
              <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO, fontWeight: 800, letterSpacing: 1.2 }}>THE ASK</Text>
              <Text fontSize={12} color={accentFor('text')} style={{ fontFamily: MONO, width: '100%' }}>{record.text}</Text>
            </Box>

            {/* resolution, in full, when filled */}
            {record.resolution ? (
              <Box style={{ flexDirection: 'column', gap: 4, borderTopWidth: 1, borderTopColor: accentFor('controlBorder'), paddingTop: 10 }}>
                <Text fontSize={10} color={accentFor('success')} style={{ fontFamily: MONO, fontWeight: 800, letterSpacing: 1.2 }}>
                  {`RESOLUTION${record.resolvedAt ? ` · ${shortStamp(record.resolvedAt)}` : ''}`}
                </Text>
                <Text fontSize={11} color={accentFor('text')} style={{ fontFamily: MONO, width: '100%' }}>{record.resolution}</Text>
                <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO }}>
                  {`commits: ${record.shas?.length ? record.shas.join(' ') : 'none — no-code resolution'}`}
                </Text>
              </Box>
            ) : null}

            {/* events/notes history */}
            {detail.events.length > 0 ? (
              <Box style={{ flexDirection: 'column', gap: 3, borderTopWidth: 1, borderTopColor: accentFor('controlBorder'), paddingTop: 10 }}>
                <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO, fontWeight: 800, letterSpacing: 1.2 }}>HISTORY</Text>
                {detail.events.map((event, index) => (
                  <Text key={index} fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO, width: '100%' }}>
                    {`${shortStamp(event.at)}  ${event.kind === 'state' ? `${event.from}→${event.to}` : 'note'}  by ${event.actor}${event.text ? `  "${event.text}"` : ''}`}
                  </Text>
                ))}
              </Box>
            ) : null}

            {/* the user's COMMENT box — "say if it is correct or not";
                appends to the same history above, any state, even done */}
            <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: accentFor('controlBorder'), paddingTop: 10 }}>
              <TextInput
                value={comment}
                onChangeText={(t: string) => setComment(t)}
                placeholder="leave a comment — correct / wrong / why…"
                fontSize={11}
                onSubmitEditing={postComment}
                style={{ flexGrow: 1, paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, backgroundColor: accentFor('bgElevated'), fontFamily: MONO }}
              />
              <Pressable
                onPress={postComment}
                style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 4, borderWidth: 1, borderColor: accentFor('info'), backgroundColor: accentFor('bgElevated') }}
              >
                <Text fontSize={11} color={accentFor('info')} style={{ fontFamily: MONO, fontWeight: 800 }}>comment</Text>
              </Pressable>
            </Box>
          </Box>
        </ScrollView>
      )}
    </C.LogPane>
  );
}
