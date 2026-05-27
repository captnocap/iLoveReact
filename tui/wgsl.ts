// tui/wgsl.ts — tiny WGSL fragment-shader evaluator for the TUI host.
//
// Same `<Effect shader={WGSL}>` API works in the terminal: at paint time we
// compile the shader once (memoized by source), then sample it at each cell.
// The compiled output is a JS function (uv, time, data) -> [r,g,b,a].
//
// Subset: the actual surface area used by carts in this repo. Scalars +
// vec2/3/4 (as plain JS arrays). Arithmetic is dispatched at runtime so we
// don't need type inference. Builtins: length/dot/abs/sqrt/exp/log/pow/sin/
// cos/tan/floor/ceil/round/fract/sign/step/smoothstep/clamp/mix/min/max/
// atan2/atan/fwidth (constant ~1e-3). Control: if/else, for, var/let/const.
// Constructors: vec2f/vec3f/vec4f (broadcast and concat). Casts: u32/i32/f32.
// Storage binding: `var<storage, read> NAME: array<f32>;` becomes `data`.
//
// What's intentionally NOT supported (yet): textures/samplers, user-defined
// structs (only the host-injected VsOut with .uv), user functions, while
// loops, switch, atomic ops, matrices. Shaders that touch those degrade to
// a "shader unsupported" stipple in the TUI host — they still work on GPU.

// ── Runtime helpers (emitted code references these by short name) ──

const R = {
  // Polymorphic arithmetic. Operands are scalar (number) or vec (number[]).
  add: (a: any, b: any): any => {
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v + b[i]);
    if (Array.isArray(a)) return a.map((v) => v + b);
    if (Array.isArray(b)) return b.map((v) => a + v);
    return a + b;
  },
  sub: (a: any, b: any): any => {
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v - b[i]);
    if (Array.isArray(a)) return a.map((v) => v - b);
    if (Array.isArray(b)) return b.map((v) => a - v);
    return a - b;
  },
  mul: (a: any, b: any): any => {
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v * b[i]);
    if (Array.isArray(a)) return a.map((v) => v * b);
    if (Array.isArray(b)) return b.map((v) => a * v);
    return a * b;
  },
  div: (a: any, b: any): any => {
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => v / b[i]);
    if (Array.isArray(a)) return a.map((v) => v / b);
    if (Array.isArray(b)) return b.map((v) => a / v);
    return a / b;
  },
  neg: (a: any): any => (Array.isArray(a) ? a.map((v) => -v) : -a),
  // Vector constructors. Broadcast a single scalar; otherwise concatenate.
  v: (n: number, args: any[]): number[] => {
    if (args.length === 1 && !Array.isArray(args[0])) {
      const r: number[] = new Array(n);
      for (let i = 0; i < n; i++) r[i] = args[0];
      return r;
    }
    const out: number[] = [];
    for (const a of args) {
      if (Array.isArray(a)) for (const v of a) out.push(v);
      else out.push(a);
    }
    while (out.length < n) out.push(0); // pad short
    if (out.length > n) out.length = n;  // truncate over
    return out;
  },
  // Swizzle "xy" / "xyz" / "rgb" / etc. on a vec.
  sw: (v: any, mask: string): any => {
    const idx: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
    if (mask.length === 1) return v[idx[mask]];
    const out: number[] = [];
    for (const c of mask) out.push(v[idx[c]]);
    return out;
  },
  // Unary scalar→scalar functions that auto-broadcast over vectors.
  u: (f: (x: number) => number, x: any): any => (Array.isArray(x) ? x.map(f) : f(x)),
  // Binary scalar-pair functions that broadcast.
  b2: (f: (a: number, b: number) => number, a: any, b: any): any => {
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => f(v, b[i]));
    if (Array.isArray(a)) return a.map((v) => f(v, b));
    if (Array.isArray(b)) return b.map((v) => f(a, v));
    return f(a, b);
  },
  // length / dot — collapse to scalar.
  len: (v: any): number => {
    if (!Array.isArray(v)) return Math.abs(v);
    let s = 0; for (const x of v) s += x * x; return Math.sqrt(s);
  },
  dot: (a: any, b: any): number => {
    if (!Array.isArray(a)) return a * b;
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
  },
  normalize: (v: any): any => {
    if (!Array.isArray(v)) return Math.sign(v);
    let s = 0; for (const x of v) s += x * x; const l = Math.sqrt(s) || 1;
    return v.map((x: number) => x / l);
  },
  mix: (a: any, b: any, t: any): any => R.add(R.mul(a, R.sub(1, t)), R.mul(b, t)),
  smoothstep: (e0: any, e1: any, x: any): any => {
    return R.b2((_e0, _e1) => 0, e0, e1) === undefined  // placeholder
      ? 0
      : R.u((xv) => {
          // We need scalar e0/e1 against scalar xv. The vec form needs componentwise.
          return 0;
        }, x);
  },
  // The placeholder above is a stub; real componentwise smoothstep:
  ss: (e0: any, e1: any, x: any): any => {
    const f = (e0v: number, e1v: number, xv: number): number => {
      const t = Math.max(0, Math.min(1, (xv - e0v) / (e1v - e0v || 1e-30)));
      return t * t * (3 - 2 * t);
    };
    if (Array.isArray(x)) {
      return x.map((xv, i) => f(
        Array.isArray(e0) ? e0[i] : e0,
        Array.isArray(e1) ? e1[i] : e1,
        xv,
      ));
    }
    return f(
      Array.isArray(e0) ? e0[0] : e0,
      Array.isArray(e1) ? e1[0] : e1,
      x,
    );
  },
  clamp: (x: any, lo: any, hi: any): any => R.b2(Math.min, R.b2(Math.max, x, lo), hi),
  step: (edge: any, x: any): any => R.b2((e, xv) => (xv < e ? 0 : 1), edge, x),
  // 'sign' that matches GLSL/WGSL: returns -1/0/1.
  sign: (x: any): any => R.u((v) => (v > 0 ? 1 : v < 0 ? -1 : 0), x),
  fract: (x: any): any => R.u((v) => v - Math.floor(v), x),
  fwidth: (_x: any): number => 1e-3,
  atan2: (a: any, b: any): any => R.b2(Math.atan2, a, b),
  // Casts: u32/i32 truncate toward zero.
  u32: (x: any): number => Math.trunc(Array.isArray(x) ? x[0] : x) >>> 0,
  i32: (x: any): number => Math.trunc(Array.isArray(x) ? x[0] : x) | 0,
  f32: (x: any): number => +(Array.isArray(x) ? x[0] : x),
  // Equality / comparison ops on scalars only (vec comparisons collapse via .all/.any in real WGSL; we don't use them).
};

// Map of WGSL builtin → emitter that returns a JS source string given
// already-emitted argument JS strings.
type Emit = (args: string[]) => string;
const BUILTINS: Record<string, Emit> = {
  length: (a) => `R.len(${a[0]})`,
  dot: (a) => `R.dot(${a[0]},${a[1]})`,
  normalize: (a) => `R.normalize(${a[0]})`,
  mix: (a) => `R.mix(${a[0]},${a[1]},${a[2]})`,
  smoothstep: (a) => `R.ss(${a[0]},${a[1]},${a[2]})`,
  clamp: (a) => `R.clamp(${a[0]},${a[1]},${a[2]})`,
  step: (a) => `R.step(${a[0]},${a[1]})`,
  sign: (a) => `R.sign(${a[0]})`,
  fract: (a) => `R.fract(${a[0]})`,
  fwidth: (a) => `R.fwidth(${a[0]})`,
  atan2: (a) => `R.atan2(${a[0]},${a[1]})`,
  atan:  (a) => `R.u(Math.atan,${a[0]})`,
  asin:  (a) => `R.u(Math.asin,${a[0]})`,
  acos:  (a) => `R.u(Math.acos,${a[0]})`,
  sin:   (a) => `R.u(Math.sin,${a[0]})`,
  cos:   (a) => `R.u(Math.cos,${a[0]})`,
  tan:   (a) => `R.u(Math.tan,${a[0]})`,
  abs:   (a) => `R.u(Math.abs,${a[0]})`,
  sqrt:  (a) => `R.u(Math.sqrt,${a[0]})`,
  exp:   (a) => `R.u(Math.exp,${a[0]})`,
  log:   (a) => `R.u(Math.log,${a[0]})`,
  exp2:  (a) => `R.u((v)=>Math.pow(2,v),${a[0]})`,
  log2:  (a) => `R.u(Math.log2,${a[0]})`,
  pow:   (a) => `R.b2(Math.pow,${a[0]},${a[1]})`,
  floor: (a) => `R.u(Math.floor,${a[0]})`,
  ceil:  (a) => `R.u(Math.ceil,${a[0]})`,
  round: (a) => `R.u(Math.round,${a[0]})`,
  trunc: (a) => `R.u(Math.trunc,${a[0]})`,
  min:   (a) => `R.b2(Math.min,${a[0]},${a[1]})`,
  max:   (a) => `R.b2(Math.max,${a[0]},${a[1]})`,
  vec2f: (a) => `R.v(2,[${a.join(',')}])`,
  vec3f: (a) => `R.v(3,[${a.join(',')}])`,
  vec4f: (a) => `R.v(4,[${a.join(',')}])`,
  vec2:  (a) => `R.v(2,[${a.join(',')}])`,
  vec3:  (a) => `R.v(3,[${a.join(',')}])`,
  vec4:  (a) => `R.v(4,[${a.join(',')}])`,
  u32:   (a) => `R.u32(${a[0]})`,
  i32:   (a) => `R.i32(${a[0]})`,
  f32:   (a) => `R.f32(${a[0]})`,
};

// ── Lexer ──────────────────────────────────────────────────────────

type Tok =
  | { k: 'num'; v: number }
  | { k: 'id';  v: string }
  | { k: 'op';  v: string }
  | { k: 'kw';  v: string }
  | { k: 'eof' };

const KW = new Set([
  'fn', 'let', 'var', 'const', 'return', 'if', 'else', 'for', 'while',
  'break', 'continue', 'true', 'false', 'struct',
]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      // exponent
      if (src[j] === 'e' || src[j] === 'E') {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && /[0-9]/.test(src[j])) j++;
      }
      const numStr = src.slice(i, j);
      // strip type suffix (0u, 0.0f, 1i)
      i = j;
      if (src[i] === 'u' || src[i] === 'i' || src[i] === 'f') i++;
      out.push({ k: 'num', v: parseFloat(numStr) });
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      i = j;
      out.push(KW.has(w) ? { k: 'kw', v: w } : { k: 'id', v: w });
      continue;
    }
    if (c === '@') {
      // Strip attributes: @group(0) @binding(1) @fragment @location(0) @vertex etc.
      // Consume name and any parenthesized arg list.
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      if (src[j] === '(') {
        let depth = 1; j++;
        while (j < n && depth > 0) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')') depth--;
          j++;
        }
      }
      i = j;
      continue;
    }
    // multi-char ops
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||'
        || two === '<<' || two === '>>' || two === '+=' || two === '-=' || two === '*=' || two === '/=') {
      out.push({ k: 'op', v: two }); i += 2; continue;
    }
    if ('+-*/%(){}[],;:.<>=!?&|^~'.includes(c)) {
      out.push({ k: 'op', v: c }); i++; continue;
    }
    // unknown char — skip
    i++;
  }
  out.push({ k: 'eof' });
  return out;
}

// ── Parser → JS source emitter ─────────────────────────────────────
//
// We don't build an AST; we emit JS source as we parse. Vec-vs-scalar is
// resolved at runtime by the R.* helpers.

class P {
  toks: Tok[];
  pos = 0;
  // Names that came from the storage binding (so we emit `data[...]` instead
  // of the original identifier). The compiler populates this.
  storageName = '';
  constructor(toks: Tok[]) { this.toks = toks; }
  peek(o = 0): Tok { return this.toks[this.pos + o] ?? { k: 'eof' }; }
  eat(): Tok { return this.toks[this.pos++]; }
  isOp(v: string): boolean { const t = this.peek(); return t.k === 'op' && t.v === v; }
  isKw(v: string): boolean { const t = this.peek(); return t.k === 'kw' && t.v === v; }
  match(v: string): boolean { if (this.isOp(v)) { this.pos++; return true; } return false; }
  expect(v: string): void {
    const t = this.eat();
    if (!(t.k === 'op' && t.v === v) && !(t.k === 'kw' && t.v === v)) {
      throw new Error(`wgsl: expected '${v}', got ${JSON.stringify(t)}`);
    }
  }

  // Skip a WGSL type annotation: `: T` where T can be `vec3<f32>`, `array<f32>`, `u32`, etc.
  skipTypeAnno(): void {
    if (!this.match(':')) return;
    this.skipType();
  }
  skipType(): void {
    // type-name with optional <...>
    const t = this.eat();
    if (t.k !== 'id' && t.k !== 'kw') throw new Error('wgsl: bad type');
    if (this.match('<')) {
      let depth = 1;
      while (depth > 0) {
        const tt = this.eat();
        if (tt.k === 'op' && tt.v === '<') depth++;
        else if (tt.k === 'op' && tt.v === '>') depth--;
        else if (tt.k === 'eof') throw new Error('wgsl: unterminated <');
      }
    }
  }

  // Expression precedence climbing.
  parseExpr(): string { return this.parseOr(); }
  parseOr(): string {
    let l = this.parseAnd();
    while (this.isOp('||')) { this.eat(); const r = this.parseAnd(); l = `(${l}||${r})`; }
    return l;
  }
  parseAnd(): string {
    let l = this.parseEq();
    while (this.isOp('&&')) { this.eat(); const r = this.parseEq(); l = `(${l}&&${r})`; }
    return l;
  }
  parseEq(): string {
    let l = this.parseCmp();
    while (this.isOp('==') || this.isOp('!=')) {
      const op = this.eat().v; const r = this.parseCmp();
      l = `(${l}${op}${r})`;
    }
    return l;
  }
  parseCmp(): string {
    let l = this.parseAdd();
    while (this.isOp('<') || this.isOp('>') || this.isOp('<=') || this.isOp('>=')) {
      const op = this.eat().v; const r = this.parseAdd();
      l = `(${l}${op}${r})`;
    }
    return l;
  }
  parseAdd(): string {
    let l = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.eat().v; const r = this.parseMul();
      l = op === '+' ? `R.add(${l},${r})` : `R.sub(${l},${r})`;
    }
    return l;
  }
  parseMul(): string {
    let l = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.eat().v; const r = this.parseUnary();
      if (op === '*') l = `R.mul(${l},${r})`;
      else if (op === '/') l = `R.div(${l},${r})`;
      else l = `R.b2((a,b)=>a%b,${l},${r})`;
    }
    return l;
  }
  parseUnary(): string {
    if (this.match('-')) return `R.neg(${this.parseUnary()})`;
    if (this.match('+')) return this.parseUnary();
    if (this.match('!')) return `(!${this.parseUnary()})`;
    return this.parsePostfix();
  }
  parsePostfix(): string {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isOp('.')) {
        this.eat();
        const id = this.eat();
        if (id.k !== 'id' && id.k !== 'kw') throw new Error('wgsl: expected field');
        const name = id.v;
        // VsOut.uv: leave as struct field access on the JS `_in` object.
        if (e === '_in' && name === 'uv') { e = `_in.uv`; continue; }
        // Otherwise: swizzle or single-component vec access.
        if (/^[xyzwrgba]+$/.test(name)) {
          if (name.length === 1) {
            const idx = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 }[name as 'x'];
            e = `${e}[${idx}]`;
          } else {
            e = `R.sw(${e},"${name}")`;
          }
        } else {
          // Unknown field — best effort.
          e = `${e}.${name}`;
        }
      } else if (this.isOp('[')) {
        this.eat();
        const idx = this.parseExpr();
        this.expect(']');
        e = `${e}[${idx}|0]`;
      } else {
        break;
      }
    }
    return e;
  }
  parsePrimary(): string {
    const t = this.peek();
    if (t.k === 'num') { this.eat(); return String(t.v); }
    if (t.k === 'kw' && (t.v === 'true' || t.v === 'false')) { this.eat(); return t.v; }
    if (t.k === 'op' && t.v === '(') {
      this.eat();
      const e = this.parseExpr();
      this.expect(')');
      return `(${e})`;
    }
    if (t.k === 'id') {
      this.eat();
      const name = t.v;
      // Call?
      if (this.match('(')) {
        const args: string[] = [];
        if (!this.isOp(')')) {
          args.push(this.parseExpr());
          while (this.match(',')) args.push(this.parseExpr());
        }
        this.expect(')');
        const emit = BUILTINS[name];
        if (emit) return emit(args);
        // Unknown call → emit literally, may fail at runtime.
        return `${name}(${args.join(',')})`;
      }
      // Identifier — `in` becomes `_in`; storage binding becomes `data`.
      if (name === 'in') return '_in';
      if (name === this.storageName) return 'data';
      return name;
    }
    throw new Error(`wgsl: unexpected token ${JSON.stringify(t)}`);
  }

  // Statements.
  parseBlock(): string {
    this.expect('{');
    let out = '';
    while (!this.isOp('}')) {
      out += this.parseStmt();
    }
    this.expect('}');
    return out;
  }
  parseStmt(): string {
    if (this.isKw('let') || this.isKw('const')) {
      this.eat();
      const id = this.eat();
      if (id.k !== 'id') throw new Error('wgsl: expected name after let/const');
      this.skipTypeAnno();
      this.expect('=');
      const v = this.parseExpr();
      this.expect(';');
      return `const ${id.v}=${v};\n`;
    }
    if (this.isKw('var')) {
      this.eat();
      const id = this.eat();
      if (id.k !== 'id') throw new Error('wgsl: expected name after var');
      this.skipTypeAnno();
      let init = 'undefined';
      if (this.match('=')) init = this.parseExpr();
      this.expect(';');
      return `let ${id.v}=${init};\n`;
    }
    if (this.isKw('return')) {
      this.eat();
      const v = this.parseExpr();
      this.expect(';');
      return `return ${v};\n`;
    }
    if (this.isKw('if')) {
      this.eat();
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      const body = this.parseBlock();
      let out = `if(${cond}){${body}}`;
      while (this.isKw('else')) {
        this.eat();
        if (this.isKw('if')) {
          this.eat();
          this.expect('(');
          const c2 = this.parseExpr();
          this.expect(')');
          const b2 = this.parseBlock();
          out += `else if(${c2}){${b2}}`;
        } else {
          const b2 = this.parseBlock();
          out += `else{${b2}}`;
        }
      }
      return out + '\n';
    }
    if (this.isKw('for')) {
      this.eat();
      this.expect('(');
      // init
      let init = '';
      if (this.isKw('var') || this.isKw('let')) {
        this.eat();
        const id = this.eat();
        if (id.k !== 'id') throw new Error('wgsl: for init name');
        this.skipTypeAnno();
        this.expect('=');
        const v = this.parseExpr();
        init = `let ${id.v}=${v}`;
      } else if (!this.isOp(';')) {
        init = this.parseExpr();
      }
      this.expect(';');
      const cond = this.isOp(';') ? 'true' : this.parseExpr();
      this.expect(';');
      // step: support `i = i + 1u` or `i++`
      let step = '';
      if (!this.isOp(')')) {
        // Detect `id = expr`
        const save = this.pos;
        const t0 = this.peek();
        if (t0.k === 'id') {
          const idName = t0.v;
          this.eat();
          if (this.match('=')) {
            const rhs = this.parseExpr();
            step = `${idName}=${rhs}`;
          } else if (this.match('+=')) {
            const rhs = this.parseExpr();
            step = `${idName}=R.add(${idName},${rhs})`;
          } else if (this.match('-=')) {
            const rhs = this.parseExpr();
            step = `${idName}=R.sub(${idName},${rhs})`;
          } else {
            this.pos = save;
            step = this.parseExpr();
          }
        } else {
          step = this.parseExpr();
        }
      }
      this.expect(')');
      const body = this.parseBlock();
      return `for(${init};${cond};${step}){${body}}\n`;
    }
    if (this.isKw('break')) { this.eat(); this.expect(';'); return 'break;\n'; }
    if (this.isKw('continue')) { this.eat(); this.expect(';'); return 'continue;\n'; }
    if (this.isOp('{')) { return `{${this.parseBlock()}}\n`; }
    // Expression statement, with optional assignment.
    const lhs = this.parsePostfix();
    if (this.match('=')) {
      const rhs = this.parseExpr();
      this.expect(';');
      return `${lhs}=${rhs};\n`;
    }
    if (this.match('+=')) { const rhs = this.parseExpr(); this.expect(';'); return `${lhs}=R.add(${lhs},${rhs});\n`; }
    if (this.match('-=')) { const rhs = this.parseExpr(); this.expect(';'); return `${lhs}=R.sub(${lhs},${rhs});\n`; }
    if (this.match('*=')) { const rhs = this.parseExpr(); this.expect(';'); return `${lhs}=R.mul(${lhs},${rhs});\n`; }
    if (this.match('/=')) { const rhs = this.parseExpr(); this.expect(';'); return `${lhs}=R.div(${lhs},${rhs});\n`; }
    this.expect(';');
    return `${lhs};\n`;
  }
}

// ── Top-level: find the storage binding name, find fs_main body, emit it. ──

export interface CompiledShader {
  sample: (
    uv: [number, number],
    time: number,
    data: number[] | Float32Array,
    sizeW?: number,
    sizeH?: number,
    mouseX?: number,
    mouseY?: number,
    mouseInside?: number,
  ) => [number, number, number, number];
}

// LRU-ish cache by shader source string.
const cache = new Map<string, CompiledShader | { error: string }>();

export function compileWgsl(src: string): CompiledShader | { error: string } {
  const hit = cache.get(src);
  if (hit) return hit;
  let res: CompiledShader | { error: string };
  try {
    res = doCompile(src);
  } catch (e: any) {
    res = { error: e?.message || String(e) };
  }
  // Cap the cache so dynamic shaders don't grow unboundedly.
  if (cache.size > 64) cache.clear();
  cache.set(src, res);
  return res;
}

function doCompile(src: string): CompiledShader {
  const toks = tokenize(src);
  // First pass — find storage binding name.
  let storageName = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'kw' && t.v === 'var') {
      let j = i + 1;
      if (toks[j]?.k === 'op' && (toks[j] as any).v === '<') {
        let depth = 1; j++;
        while (j < toks.length && depth > 0) {
          const tt = toks[j];
          if (tt.k === 'op' && tt.v === '<') depth++;
          else if (tt.k === 'op' && tt.v === '>') depth--;
          j++;
        }
        if (toks[j]?.k === 'id') storageName = (toks[j] as any).v;
      }
    }
  }

  // Second pass — walk every top-level `fn NAME(...) -> ... { BODY }` and
  // emit it as JS. fs_main becomes the entrypoint; everything else lands in
  // the same closure and is callable by name (rand2, layer, lightAt, etc.).
  const p = new P(toks);
  p.storageName = storageName;
  p.pos = 0;
  let helperSrc = '';
  let fsBody = '';
  let foundFsMain = false;
  while (p.peek().k !== 'eof') {
    const t = p.peek();
    if (t.k === 'kw' && t.v === 'fn') {
      p.eat(); // fn
      const nameTok = p.eat();
      if (nameTok.k !== 'id') throw new Error('wgsl: expected fn name');
      const name = nameTok.v;
      // Parse parameter list: NAME: TYPE, ...
      p.expect('(');
      const params: string[] = [];
      if (!p.isOp(')')) {
        for (;;) {
          const pn = p.eat();
          if (pn.k !== 'id') throw new Error('wgsl: expected param name');
          params.push(pn.v);
          p.skipTypeAnno();
          if (!p.match(',')) break;
        }
      }
      p.expect(')');
      // Optional `-> RET`. fs_main has `-> @location(0) vec4f`; helpers have `-> f32`.
      if (p.isOp('-')) {
        p.eat();
        p.expect('>');
        p.skipType();
      }
      const body = p.parseBlock();
      if (name === 'fs_main') {
        fsBody = body;
        foundFsMain = true;
      } else {
        helperSrc += `function ${name}(${params.join(',')}) {\n${body}}\n`;
      }
      continue;
    }
    // Skip anything else at top level — module-scope var/let/const bindings
    // are already consumed by the storage-name pass above; nothing else
    // should be load-bearing for the fragment program.
    p.eat();
  }
  if (!foundFsMain) throw new Error('wgsl: no fs_main found');
  const body = helperSrc + fsBody;

  // Build the JS function. The shader returns vec4f (rgba); we coerce to a
  // 4-element array of clamped 0..1 floats.
  // size_w / size_h are passed in by the caller — many shaders multiply uv by
  // these to get pixel coordinates (e.g., plasma's `x = uv.x * U.size_w`).
  // In TUI we treat one terminal "cell" as one pixel column and two pixel
  // rows (half-block trick), so caller passes box.w and box.h*2.
  const fnSrc = `
    "use strict";
    const _in = { uv: [uv0, uv1] };
    const U = { size_w: sizeW, size_h: sizeH, time: time, dt: 0, frame: 0,
                mouse_x: mouseX, mouse_y: mouseY, mouse_inside: mouseInside };
    ${body}
    return [0,0,0,1];
  `;
  // eslint-disable-next-line no-new-func
  const fn = new Function('uv0', 'uv1', 'time', 'data', 'sizeW', 'sizeH', 'mouseX', 'mouseY', 'mouseInside', 'R', fnSrc) as (
    uv0: number, uv1: number, time: number, data: any, sizeW: number, sizeH: number,
    mouseX: number, mouseY: number, mouseInside: number, R: any,
  ) => any;

  // Replace the trailing `return [0,0,0,1]` fallback by re-parsing? Simpler:
  // intercept return values from the shader's own `return` statements. Since
  // every shader path returns, the trailing fallback is just a safety net.

  return {
    sample(
      uv: [number, number], time: number, data: number[] | Float32Array,
      sizeW?: number, sizeH?: number,
      mouseX?: number, mouseY?: number, mouseInside?: number,
    ): [number, number, number, number] {
      try {
        const r = fn(
          uv[0], uv[1], time, data || [],
          sizeW ?? 1, sizeH ?? 1,
          mouseX ?? 0, mouseY ?? 0, mouseInside ?? 0,
          R,
        );
        if (Array.isArray(r)) {
          const out: [number, number, number, number] = [
            clamp01(r[0] ?? 0),
            clamp01(r[1] ?? 0),
            clamp01(r[2] ?? 0),
            clamp01(r[3] ?? 1),
          ];
          return out;
        }
        const v = clamp01(+r || 0);
        return [v, v, v, 1];
      } catch {
        return [0, 0, 0, 0];
      }
    },
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
