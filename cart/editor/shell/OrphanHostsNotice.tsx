import { Col, Pressable, Row, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';

const PANEL = '#10151d';
const BORDER = '#34465d';
const TEXT = '#dbe5f3';
const DIM = '#8fa0b5';
const ACCENT = '#e5bd79';

export interface OrphanHostsNoticeState {
  title: string;
  message: string;
  detail: string;
  token: string;
  approvalPath: string;
  pids: number[];
  collapsed: boolean;
}

/** Orphaned dev hosts are invisible by definition — no window, no socket, nothing
 *  attached to them. On 2026-08-08 nine had accumulated over six days holding 4.7 GB and
 *  the user's honest read was "I have 1 running app as far as I am concerned" (req_4074).
 *  This notice is the only place they surface, so it states the pids rather than a count
 *  the user has to trust, and it says plainly that this app is not one of them. */
export function orphanHostsNoticeFromPayload(payload: any): OrphanHostsNoticeState | null {
  if (payload?.kind !== 'orphan-hosts'
      || typeof payload?.token !== 'string'
      || !payload.token.startsWith('orphan-hosts-v1:')
      || typeof payload?.approvalPath !== 'string'
      || !payload.approvalPath.endsWith('/.cache/dev-orphan-cleanup.json')
      || !Array.isArray(payload?.pids)) return null;
  // Only whole positive pids cross into the UI. A malformed row must not become a
  // number this notice later asks the supervisor to signal.
  const pids = payload.pids.filter((pid: unknown) => Number.isInteger(pid) && (pid as number) > 1);
  if (pids.length === 0) return null;
  return {
    title: typeof payload.title === 'string' ? payload.title : 'Orphaned dev hosts',
    message: typeof payload.message === 'string' ? payload.message : 'Dev hosts kept running after their launcher exited.',
    detail: typeof payload.detail === 'string' ? payload.detail : '',
    token: payload.token,
    approvalPath: payload.approvalPath,
    pids,
    collapsed: true,
  };
}

export function orphanCleanupApprovalJson(token: string, pids: readonly number[]): string {
  // The approved pids ride the approval, so the supervisor retires exactly what the
  // user was shown — never a rescan that might have drifted since the click.
  return JSON.stringify({ token, pids, requestedAt: new Date().toISOString() });
}

export default function OrphanHostsNotice({ notice, onClean, onLater }: {
  notice: OrphanHostsNoticeState;
  onClean: () => void;
  onLater: () => void;
}) {
  const shown = notice.pids.slice(0, 12);
  return (
    <Col style={{ position: 'absolute', right: 10, bottom: 40, width: 430, gap: 9, padding: 13, borderWidth: 1, borderColor: BORDER, borderRadius: 9, backgroundColor: PANEL }}>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Icon name="Trash2" size={14} color={ACCENT} />
        <Text fontSize={12} color={TEXT} style={{ fontWeight: 800 }}>{notice.title}</Text>
      </Row>
      <Text fontSize={11} color={TEXT}>{notice.message}</Text>
      <Text fontSize={10} color={DIM}>{notice.detail}</Text>
      <Text fontSize={10} color={DIM}>
        {`pids ${shown.join(', ')}${notice.pids.length > shown.length ? ` +${notice.pids.length - shown.length} more` : ''}`}
      </Text>
      <Text fontSize={10} color={ACCENT}>Each pid is re-checked before it is signalled — anything that gained a window or the dev socket is spared. This editor is never in the list.</Text>
      <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Pressable onPress={onLater} style={{ height: 27, paddingLeft: 10, paddingRight: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER, borderRadius: 5 }}>
          <Text fontSize={10} color={DIM}>Leave them</Text>
        </Pressable>
        <Pressable
          onPress={onClean}
          style={{ height: 27, paddingLeft: 11, paddingRight: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: ACCENT }}
        >
          <Text fontSize={10} color="#1a1206" style={{ fontWeight: 800 }}>{`Retire ${notice.pids.length}`}</Text>
        </Pressable>
      </Row>
    </Col>
  );
}
