// useIftttTail — poll the per-session log file that claude-ss writes
// inside the VM. Each line is one envelope: {event, ts, payload}.
// Once the vsock event bus lands, this becomes the fallback path.

import { useEffect, useRef, useState } from 'react';
import type { IftttEvent } from '../types';

export function useIftttTail(path: string): IftttEvent[] {
  const [events, setEvents] = useState<IftttEvent[]>([]);
  const seenLines = useRef(0);

  useEffect(() => {
    const tick = () => {
      const g: any = globalThis;
      let text = '';
      try { text = g.__fs_read?.(path) ?? ''; } catch { return; }
      if (!text) return;
      const lines = text.split('\n').filter((l: string) => l.length > 0);
      if (lines.length <= seenLines.current) return;
      const fresh = lines.slice(seenLines.current);
      seenLines.current = lines.length;
      const parsed: IftttEvent[] = fresh.map((raw: string) => {
        try {
          const obj = JSON.parse(raw);
          return {
            event: String(obj.event ?? '?'),
            ts: Number(obj.ts ?? 0),
            payload: obj.payload ?? null,
            raw,
          };
        } catch {
          return { event: 'unparsed', ts: Date.now(), payload: raw, raw };
        }
      });
      setEvents(prev => [...prev, ...parsed].slice(-200));
    };
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  }, [path]);

  return events;
}
