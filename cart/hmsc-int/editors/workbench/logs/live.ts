// editors/workbench/logs/live.ts — the LOGS store's LIVE singleton
// (WBSET9-0606; the paint/live.ts split). Ring deps = perfLog's exported
// doors (LogView.tsx's exact wires: getLogLines/subscribeLog/clearLog/
// isLoggingEnabled/setLoggingEnabled/logFilePath); bus deps = the sessions
// fold behind a try (a corrupt sessions stream leaves the churn feed fully
// live and surfaces the store-unavailable warning on the bus rows — the
// census/settings.md C3 parity).

import {
  clearLog, getLogLines, isLoggingEnabled, logFilePath, setLoggingEnabled, subscribeLog,
} from '../../../perfLog';
import { editorSessions, type SessionsState } from '../../sessions';
import { createLogsStore, type LogsStore } from './store';

let live: LogsStore | null = null;

export function logsWorkbenchStore(): LogsStore {
  if (live) return live;
  let busError: string | null = null;
  try {
    editorSessions().state(); // probe once so the error is namable at init
  } catch (e: any) {
    busError = String(e?.message ?? e);
  }
  live = createLogsStore({
    ring: {
      lines: getLogLines,
      enabled: isLoggingEnabled,
      setEnabled: setLoggingEnabled,
      clear: clearLog,
      path: logFilePath,
      subscribe: subscribeLog,
    },
    bus: (): SessionsState | null => {
      try { return editorSessions().state(); } catch { return null; }
    },
    busError,
  });
  return live;
}
