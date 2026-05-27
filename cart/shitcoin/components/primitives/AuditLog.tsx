// AuditLog — time-ordered list of fire events with status pills.

import { classifiers as C } from '../../../../runtime/classifier';
import './AuditLog.cls';

export type AuditStatus = 'ok' | 'warn' | 'err';

export interface AuditEntry {
  key: string | number;
  /** Real-ms timestamp; formatted as elapsed-since by the row. */
  realMs: number;
  message: string;
  status?: AuditStatus;
  statusLabel?: string;
}

export interface AuditLogProps {
  entries: AuditEntry[];
  /** Current real-ms for "x ago" formatting. */
  nowMs?: number;
  /** Hard cap on rows rendered. Default 100. */
  max?: number;
}

function relTime(realMs: number, nowMs: number): string {
  const dt = Math.max(0, nowMs - realMs);
  const s = Math.floor(dt / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h';
}

export function AuditLog({ entries, nowMs, max = 100 }: AuditLogProps) {
  const cap = Math.min(entries.length, max);
  const now = nowMs ?? Date.now();
  return (
    <C.AuditLogRoot>
      {entries.slice(0, cap).map((e) => {
        const Pill = e.status === 'warn' ? C.AuditLogPillWarn
                   : e.status === 'err' ? C.AuditLogPillErr
                   : C.AuditLogPillOk;
        return (
          <C.AuditLogRow key={e.key}>
            <C.AuditLogTime>{relTime(e.realMs, now)}</C.AuditLogTime>
            <C.AuditLogMessage>{e.message}</C.AuditLogMessage>
            {e.statusLabel || e.status ? (
              <Pill>
                <C.AuditLogPillText>{e.statusLabel ?? (e.status ?? 'ok').toUpperCase()}</C.AuditLogPillText>
              </Pill>
            ) : null}
          </C.AuditLogRow>
        );
      })}
    </C.AuditLogRoot>
  );
}
