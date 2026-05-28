// cli/host/argv.ts - one argv parser.

export interface ArgSpec {
  positional?: string[];
  flags?: Record<string, 'bool' | 'string' | 'number'>;
  passthroughAfter?: string;
}

export interface ParsedArgs {
  positional: Record<string, string>;
  flags: Record<string, string | number | boolean>;
  rest: string[];
}

export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const out: ParsedArgs = { positional: {}, flags: {}, rest: [] };
  const positionals = spec.positional ?? [];
  let posIdx = 0;
  let collecting = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (collecting) {
      out.rest.push(arg);
      continue;
    }
    if (arg === spec.passthroughAfter) {
      collecting = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const kind = spec.flags?.[name];
      if (!kind) throw new Error(`unknown flag: ${arg}`);
      if (kind === 'bool') {
        out.flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`flag ${arg} requires a value`);
      i++;
      out.flags[name] = kind === 'number' ? Number(next) : next;
      continue;
    }

    const posName = positionals[posIdx++];
    if (!posName) throw new Error(`unexpected positional: ${arg}`);
    out.positional[posName] = arg;
  }

  return out;
}
