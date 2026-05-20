// Small shared helpers used across bridge/* — env/cwd/exec wrappers,
// timestamp utilities, hex generation, shell quoting. Direct
// extractions from cart/claude_openai_bridge_tui.tsx.

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function randHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function envGet(key: string): string {
  const g: any = globalThis;
  try {
    return g.__env?.(key) ?? g.__env_get?.(key) ?? '';
  } catch {
    return '';
  }
}

export function cwdGet(): string {
  const g: any = globalThis;
  try {
    return g.__cwd?.() || envGet('PWD') || '/';
  } catch {
    return envGet('PWD') || '/';
  }
}

export function execOut(cmd: string): string {
  const g: any = globalThis;
  try {
    return String(g.__exec?.(cmd) ?? '');
  } catch {
    return '';
  }
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function runtimeDir(): string {
  const xdg = envGet('XDG_RUNTIME_DIR');
  if (xdg) return xdg;
  const uid = execOut('id -u').trim();
  return uid ? `/run/user/${uid}` : '/run/user/1000';
}

export function claudeProjectSlug(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, '') || '/';
  return normalized.replace(/\//g, '-').replace(/[^A-Za-z0-9_.-]/g, '-');
}

export function claudeProjectDir(): string {
  const home = envGet('HOME') || '/tmp';
  return `${home}/.claude/projects/${claudeProjectSlug(cwdGet())}`;
}
