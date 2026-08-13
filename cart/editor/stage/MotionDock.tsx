// The motion workbench dock (req_4285, req_0576 execution): the human surface
// over the RJAN store and the mixer.
//
// One strip under the capture panes: record a take, open it as an editable
// document, author keys from the captured pose (capture is the pose input),
// scrub the mixer, re-time keys, and play the document on the embodied /play
// player. React declares times and poses; every fill-in, clamp, and byte
// stays native.

import { useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import type { CaptureSessionSnapshot } from '../../../runtime/skeleton';
import type { NativeCaptureSessionApi } from '../skeleton/captureSession';
import {
  MOTION_ROLE_CHANNELS,
  MotionDocumentFault,
  MOTION_LIBRARY_DIR,
  currentPlayWorldNode,
  ensureMotionLibraryDir,
  loadMotionDocument,
  motionDoorsAvailable,
  motionLibraryPath,
  newMotionDocument,
  playMotion,
  removeKey,
  resumeMotion,
  retimeKey,
  saveMotionDocument,
  scrubMotion,
  stopMotion,
  addKey,
  type MotionDocumentJson,
  type MotionQuat,
} from '../skeleton/motionDocuments';

const ROLE_GROUPS: ReadonlyArray<{ label: string; channels: readonly string[] }> = [
  { label: 'TORSO', channels: ['pelvis', 'spine_lower', 'spine_upper', 'neck', 'head'] },
  { label: 'ARM L', channels: ['clavicle_left', 'upper_arm_left', 'lower_arm_left'] },
  { label: 'ARM R', channels: ['clavicle_right', 'upper_arm_right', 'lower_arm_right'] },
  { label: 'LEG L', channels: ['upper_leg_left', 'lower_leg_left'] },
  { label: 'LEG R', channels: ['upper_leg_right', 'lower_leg_right'] },
];

const TIMELINE_TICKS = 40;
const TRACK_WIDTH = 640;
const NUDGE_SECONDS = 0.05;
const IDENTITY_QUAT: MotionQuat = [0, 0, 0, 1];

function DockButton(props: { label: string; tone?: 'hot' | 'go' | 'flat'; disabled?: boolean; onPress: () => void }) {
  const tone = props.tone ?? 'flat';
  const border = props.disabled ? '#2a303a' : tone === 'hot' ? '#8a4040' : tone === 'go' ? '#3b5d55' : '#3a4656';
  const back = props.disabled ? '#0e1218' : tone === 'hot' ? '#2c1414' : tone === 'go' ? '#12251f' : '#121821';
  const color = props.disabled ? '#5a6472' : tone === 'hot' ? '#f0938a' : tone === 'go' ? '#9be4c9' : '#b8c5d5';
  return (
    <Pressable
      onPress={() => { if (!props.disabled) props.onPress(); }}
      style={{ height: 24, paddingLeft: 8, paddingRight: 8, justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: border, backgroundColor: back }}
    >
      <Text style={{ color, fontSize: 9, fontFamily: 'monospace' }}>{props.label}</Text>
    </Pressable>
  );
}

export default function MotionDock(props: {
  api: NativeCaptureSessionApi;
  snapshot: CaptureSessionSnapshot | null;
}) {
  const [doc, setDoc] = useState<MotionDocumentJson | null>(null);
  const [docPath, setDocPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [mountedOnPlay, setMountedOnPlay] = useState(false);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const recording = props.snapshot?.recording ?? null;
  const captureLive = props.snapshot !== null && props.snapshot.target !== null;
  const playNode = currentPlayWorldNode();
  const doors = motionDoorsAvailable();

  const report = (action: () => void) => {
    try {
      action();
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof MotionDocumentFault || error instanceof Error ? error.message : String(error));
    }
  };

  const editDoc = (next: MotionDocumentJson) => {
    setDoc(next);
    setDirty(true);
  };

  /** PLAY writes the edited document to its library path first: the mixer
   * plays disk truth, never an unsaved phantom. */
  const savedPathForPlayback = (): string => {
    if (!doc) throw new MotionDocumentFault('no open motion document');
    if (!dirty && docPath) return docPath;
    ensureMotionLibraryDir();
    const path = motionLibraryPath(doc.name);
    saveMotionDocument(path, doc);
    setDocPath(path);
    setDirty(false);
    return path;
  };

  const toggleRecord = () => report(() => {
    if (recording) {
      ensureMotionLibraryDir();
      const take = props.api.recordStop(MOTION_LIBRARY_DIR, `take ${new Date().toISOString().slice(11, 19)}`);
      const opened = loadMotionDocument(take.path);
      setDoc(opened);
      setDocPath(take.path);
      setDirty(false);
      setPlayhead(0);
      setSelectedKey(null);
      setStatus(`take saved · ${take.frameCount} frames · ${take.durationSeconds.toFixed(2)}s${take.truncated ? ' · TRUNCATED' : ''}`);
    } else {
      props.api.record();
    }
  });

  const newDocument = () => report(() => {
    setDoc(newMotionDocument('untitled-motion', [...MOTION_ROLE_CHANNELS]));
    setDocPath(null);
    setDirty(true);
    setPlayhead(0);
    setSelectedKey(null);
  });

  const addKeyAtPlayhead = () => report(() => {
    if (!doc) throw new MotionDocumentFault('no open motion document');
    if (captureLive) {
      // Capture is the pose input: the promoted pose lands as a key at the
      // declared time — pose it, declare when, forget the rest.
      const sample = props.api.poseKey();
      editDoc(addKey(doc, {
        timeSeconds: playhead,
        root: sample.root as [number, number, number],
        channels: sample.channels as Record<string, MotionQuat>,
      }));
    } else {
      const channels: Record<string, MotionQuat> = {};
      for (const channel of doc.channels) channels[channel] = IDENTITY_QUAT;
      editDoc(addKey(doc, { timeSeconds: playhead, root: [0, 0, 0], channels }));
    }
    setSelectedKey(null);
  });

  const scrubTo = (seconds: number) => report(() => {
    const clamped = doc ? Math.min(Math.max(seconds, 0), doc.durationSeconds) : 0;
    setPlayhead(clamped);
    if (playNode && mountedOnPlay) scrubMotion(playNode, 0, clamped);
  });

  const togglePlay = () => report(() => {
    if (!playNode) throw new MotionDocumentFault('no mounted /play world — open the playtest surface');
    if (mountedOnPlay) {
      stopMotion(playNode, 0);
      setMountedOnPlay(false);
      return;
    }
    const path = savedPathForPlayback();
    const receipt = playMotion(playNode, path, 0);
    setMountedOnPlay(receipt.playing);
  });

  const releaseScrub = () => report(() => {
    if (playNode && mountedOnPlay) resumeMotion(playNode, 0);
  });

  const save = () => report(() => {
    if (!doc) throw new MotionDocumentFault('no open motion document');
    ensureMotionLibraryDir();
    const path = motionLibraryPath(doc.name);
    const receipt = saveMotionDocument(path, doc);
    setDocPath(receipt.path);
    setDirty(false);
    setStatus(`saved · ${receipt.path} · ${receipt.bytes} bytes`);
  });

  const duration = doc?.durationSeconds ?? 1;
  const timeToX = (seconds: number) => (seconds / duration) * TRACK_WIDTH;

  // Ghosting: the keys bracketing the playhead read brighter than the rest —
  // a pure view over the store.
  const keyTimes = doc?.keys.map((key) => key.timeSeconds) ?? [];
  const previousKeyIndex = useMemo(() => {
    let best = -1;
    keyTimes.forEach((time, index) => { if (time <= playhead && (best < 0 || time >= keyTimes[best]!)) best = index; });
    return best;
  }, [keyTimes, playhead]);
  const nextKeyIndex = useMemo(() => {
    let best = -1;
    keyTimes.forEach((time, index) => { if (time > playhead && (best < 0 || time < keyTimes[best]!)) best = index; });
    return best;
  }, [keyTimes, playhead]);

  return (
    <Col style={{ backgroundColor: '#0b0f16', borderTopWidth: 1, borderTopColor: '#2a323e' }}>
      <Row style={{ minHeight: 34, paddingLeft: 9, paddingRight: 9, gap: 6, alignItems: 'center' }}>
        <Text style={{ color: '#d4a8ff', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>MOTION</Text>
        <DockButton
          label={recording ? `STOP REC · ${recording.frameCount}${recording.truncated ? ' · TRUNCATING' : ''}` : 'REC TAKE'}
          tone={recording ? 'hot' : 'go'}
          disabled={!props.snapshot}
          onPress={toggleRecord}
        />
        <DockButton label="NEW DOC" onPress={newDocument} />
        <DockButton label="ADD KEY @ PLAYHEAD" tone="go" disabled={!doc} onPress={addKeyAtPlayhead} />
        <DockButton label="SAVE" disabled={!doc || !doors} onPress={save} />
        <DockButton
          label={mountedOnPlay ? 'STOP /play' : 'PLAY on /play'}
          tone={mountedOnPlay ? 'hot' : 'go'}
          disabled={!doc || !doors || !playNode}
          onPress={togglePlay}
        />
        <DockButton label="RESUME" disabled={!mountedOnPlay} onPress={releaseScrub} />
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: '#8e9baa', fontSize: 9, fontFamily: 'monospace' }} numberOfLines={1} noWrap>
          {doc
            ? `${doc.name}${dirty ? ' *' : ''} · ${doc.durationSeconds.toFixed(2)}s · ${doc.keys.length} keys · ${doc.runs?.length ?? 0} runs · playhead ${playhead.toFixed(2)}s`
            : playNode
              ? 'no open document — REC a take or NEW DOC'
              : 'no open document · open /play to enable playback'}
        </Text>
      </Row>

      {status ? (
        <Row style={{ minHeight: 22, paddingLeft: 10, alignItems: 'center', backgroundColor: '#141a24' }}>
          <Text style={{ color: '#cdb277', fontSize: 9, fontFamily: 'monospace' }} numberOfLines={1} noWrap>{status}</Text>
        </Row>
      ) : null}

      {doc ? (
        <Col style={{ paddingLeft: 9, paddingRight: 9, paddingBottom: 8 }}>
          {/* Scrub track: press a tick to park the mixer playhead there. */}
          <Row style={{ height: 18, marginTop: 4, alignItems: 'center', gap: 6 }}>
            <Text style={{ width: 44, color: '#63ccec', fontSize: 8, fontFamily: 'monospace' }}>SCRUB</Text>
            <Box style={{ width: TRACK_WIDTH, height: 14, position: 'relative', backgroundColor: '#10151d', borderRadius: 3 }}>
              <Row style={{ position: 'absolute', left: 0, top: 0, width: TRACK_WIDTH, height: 14 }}>
                {Array.from({ length: TIMELINE_TICKS + 1 }, (_, tick) => (
                  <Pressable
                    key={`tick-${tick}`}
                    onPress={() => scrubTo(duration * tick / TIMELINE_TICKS)}
                    style={{ width: TRACK_WIDTH / (TIMELINE_TICKS + 1), height: 14, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Box style={{ width: 1, height: tick % 5 === 0 ? 9 : 5, backgroundColor: '#2c3644' }} />
                  </Pressable>
                ))}
              </Row>
              <Box style={{ position: 'absolute', left: Math.round(timeToX(playhead)) - 1, top: 0, width: 2, height: 14, backgroundColor: '#7edcf2' }} />
            </Box>
            <DockButton label="−" onPress={() => scrubTo(playhead - 0.01)} />
            <DockButton label="+" onPress={() => scrubTo(playhead + 0.01)} />
          </Row>

          {/* Keys per role group. A key spanning several groups shows in each;
              re-timing moves the whole declared instant. */}
          {ROLE_GROUPS.map((group) => {
            const groupChannels = group.channels.filter((channel) => doc.channels.includes(channel));
            if (groupChannels.length === 0) return null;
            return (
              <Row key={group.label} style={{ height: 16, alignItems: 'center', gap: 6 }}>
                <Text style={{ width: 44, color: '#758090', fontSize: 8, fontFamily: 'monospace' }}>{group.label}</Text>
                <Box style={{ width: TRACK_WIDTH, height: 12, position: 'relative', backgroundColor: '#0d121a', borderRadius: 3 }}>
                  {doc.keys.map((key, index) => {
                    const covers = groupChannels.some((channel) => key.channels[channel] !== undefined);
                    if (!covers) return null;
                    const ghost = index === previousKeyIndex || index === nextKeyIndex;
                    const selected = index === selectedKey;
                    return (
                      <Pressable
                        key={`key-${group.label}-${index}`}
                        onPress={() => setSelectedKey(selected ? null : index)}
                        style={{
                          position: 'absolute',
                          left: Math.round(timeToX(key.timeSeconds)) - 4,
                          top: 1,
                          width: 9,
                          height: 10,
                          borderRadius: 2,
                          backgroundColor: selected ? '#f1c66b' : ghost ? '#9be4c9' : '#4f6f8f',
                        }}
                      />
                    );
                  })}
                  {doc.runs?.map((run, index) => {
                    const covers = groupChannels.some((channel) => run.channels.includes(channel));
                    if (!covers) return null;
                    const start = timeToX(run.startSeconds);
                    const end = timeToX(run.startSeconds + run.times[run.times.length - 1]!);
                    return (
                      <Box
                        key={`run-${group.label}-${index}`}
                        style={{ position: 'absolute', left: Math.round(start), top: 4, width: Math.max(2, Math.round(end - start)), height: 4, borderRadius: 2, backgroundColor: '#3f8f6a' }}
                      />
                    );
                  })}
                </Box>
              </Row>
            );
          })}

          {selectedKey !== null && doc.keys[selectedKey] ? (
            <Row style={{ height: 24, alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Text style={{ color: '#f1c66b', fontSize: 9, fontFamily: 'monospace' }}>
                {`key ${selectedKey} @ ${doc.keys[selectedKey]!.timeSeconds.toFixed(2)}s · ${Object.keys(doc.keys[selectedKey]!.channels).length} roles`}
              </Text>
              <DockButton label="⟨ NUDGE" onPress={() => {
                editDoc(retimeKey(doc, selectedKey, doc.keys[selectedKey]!.timeSeconds - NUDGE_SECONDS));
                setSelectedKey(null);
              }} />
              <DockButton label="NUDGE ⟩" onPress={() => {
                editDoc(retimeKey(doc, selectedKey, doc.keys[selectedKey]!.timeSeconds + NUDGE_SECONDS));
                setSelectedKey(null);
              }} />
              <DockButton label="MOVE TO PLAYHEAD" onPress={() => {
                editDoc(retimeKey(doc, selectedKey, playhead));
                setSelectedKey(null);
              }} />
              <DockButton label="DELETE" tone="hot" onPress={() => {
                editDoc(removeKey(doc, selectedKey));
                setSelectedKey(null);
              }} />
            </Row>
          ) : null}
        </Col>
      ) : null}
    </Col>
  );
}
