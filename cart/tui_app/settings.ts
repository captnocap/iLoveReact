import { useCRUD } from '../app/db';

export const NS = 'app';
export const USER_ID = 'user_local';
export const SETTINGS_ID = 'settings_default';
export const PRIVACY_ID = 'privacy_default';

export const passthrough: any = { parse: (v: unknown) => v };

export function useUserStore() {
  return useCRUD<any>('user', passthrough, { namespace: NS });
}

export function useSettingsStore() {
  return useCRUD<any>('settings', passthrough, { namespace: NS });
}

export function usePrivacyStore() {
  return useCRUD<any>('privacy', passthrough, { namespace: NS });
}

export function useConnectionStore() {
  return useCRUD<any>('connection', passthrough, { namespace: NS });
}

export function useModelStore() {
  return useCRUD<any>('model', passthrough, { namespace: NS });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function text(v: any, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function short(s: any, n = 54): string {
  const v = String(s || '');
  return v.length <= n ? v : `${v.slice(0, n - 1)}…`;
}

