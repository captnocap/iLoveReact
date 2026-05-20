// usePermissionBus — subscribe to the classifier-driven permission
// detection bus channels emitted by runtime/hooks/ifttt/permission.ts.
//
// system:permission           — every detected prompt
// system:permission:answered  — every auto-answer (from recipe actions)

import { useEffect, useState } from 'react';
import { subscribe as busSubscribe } from '../../../runtime/ffi';
import type { IftttEvent } from '../types';

export function usePermissionBus(): IftttEvent[] {
  const [events, setEvents] = useState<IftttEvent[]>([]);
  useEffect(() => {
    const push = (event: string) => (ev: any) => {
      setEvents(prev => [...prev, {
        event,
        ts: ev?.at ?? Date.now(),
        payload: ev,
        raw: JSON.stringify(ev),
      }].slice(-200));
    };
    const unsub1 = busSubscribe('system:permission', push('Permission'));
    const unsub2 = busSubscribe('system:permission:answered', push('PermissionAnswered'));
    return () => { unsub1(); unsub2(); };
  }, []);
  return events;
}
