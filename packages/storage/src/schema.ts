/**
 * Lightweight schema validation system inspired by Zod.
 *
 * Provides runtime validation AND TypeScript type inference.
 * Designed for CRUD use cases — no unions, discriminated unions,
 * or transforms. Just the essentials.
 */

// ── Validation error ────────────────────────────────────

export class ValidationError extends Error {
  constructor(
    public readonly issues: ValidationIssue[],
  ) {
    const msg = issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    super(`Validation failed: ${msg}`);
    this.name = 'ValidationError';
  }
}

export interface ValidationIssue {
  path: string[];
  message: string;
  code: string;
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError };

// ── Base schema class ───────────────────────────────────

export abstract class Schema<T> {
  protected _optional = false;
  protected _nullable = false;
  protected _default: T | undefined = undefined;

  abstract _parse(value: unknown, path: string[]): T;

  parse(value: unknown): T {
    return this._parseRoot(value, []);
  }

  safeParse(value: unknown): SafeParseResult<T> {
    try {
      const data = this.parse(value);
      return { success: true, data };
    } catch (e) {
      if (e instanceof ValidationError) {
        return { success: false, error: e };
      }
      throw e;
    }
  }

  optional(): Schema<T | undefined> {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._optional = true;
    return clone;
  }

  nullable(): Schema<T | null> {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._nullable = true;
    return clone;
  }

  default(value: T): Schema<T> {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._default = value;
    clone._optional = true;
    return clone;
  }

  protected _parseRoot(value: unknown, path: string[]): T {
    if (value === undefined) {
      if (this._default !== undefined) return this._default;
      if (this._optional) return undefined as T;
      throw new ValidationError([{ path, message: 'Required', code: 'required' }]);
    }
    if (value === null) {
      if (this._nullable) return null as T;
      throw new ValidationError([{ path, message: 'Expected non-null value', code: 'null' }]);
    }
    return this._parse(value, path);
  }
}

// ── String schema ───────────────────────────────────────

export class StringSchema extends Schema<string> {
  private _minLength?: number;
  private _maxLength?: number;
  private _pattern?: RegExp;
  private _patternMessage?: string;

  _parse(value: unknown, path: string[]): string {
    if (typeof value !== 'string') {
      throw new ValidationError([{ path, message: `Expected string, got ${typeof value}`, code: 'type' }]);
    }
    if (this._minLength !== undefined && value.length < this._minLength) {
      throw new ValidationError([{ path, message: `String must be at least ${this._minLength} characters`, code: 'min_length' }]);
    }
    if (this._maxLength !== undefined && value.length > this._maxLength) {
      throw new ValidationError([{ path, message: `String must be at most ${this._maxLength} characters`, code: 'max_length' }]);
    }
    if (this._pattern && !this._pattern.test(value)) {
      throw new ValidationError([{ path, message: this._patternMessage ?? 'Invalid format', code: 'pattern' }]);
    }
    return value;
  }

  min(length: number): StringSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._minLength = length;
    return clone;
  }

  max(length: number): StringSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._maxLength = length;
    return clone;
  }

  email(): StringSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    clone._patternMessage = 'Invalid email format';
    return clone;
  }

  url(): StringSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._pattern = /^https?:\/\/.+/;
    clone._patternMessage = 'Invalid URL format';
    return clone;
  }

  matches(pattern: RegExp, message?: string): StringSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._pattern = pattern;
    clone._patternMessage = message;
    return clone;
  }
}

// ── Number schema ───────────────────────────────────────

export class NumberSchema extends Schema<number> {
  private _min?: number;
  private _max?: number;
  private _integer = false;

  _parse(value: unknown, path: string[]): number {
    const num = typeof value === 'string' ? Number(value) : value;
    if (typeof num !== 'number' || isNaN(num)) {
      throw new ValidationError([{ path, message: `Expected number, got ${typeof value}`, code: 'type' }]);
    }
    if (this._integer && !Number.isInteger(num)) {
      throw new ValidationError([{ path, message: 'Expected integer', code: 'integer' }]);
    }
    if (this._min !== undefined && num < this._min) {
      throw new ValidationError([{ path, message: `Number must be >= ${this._min}`, code: 'min' }]);
    }
    if (this._max !== undefined && num > this._max) {
      throw new ValidationError([{ path, message: `Number must be <= ${this._max}`, code: 'max' }]);
    }
    return num;
  }

  min(value: number): NumberSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._min = value;
    return clone;
  }

  max(value: number): NumberSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._max = value;
    return clone;
  }

  int(): NumberSchema {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this);
    clone._integer = true;
    return clone;
  }
}

// ── Boolean schema ──────────────────────────────────────

export class BooleanSchema extends Schema<boolean> {
  _parse(value: unknown, path: string[]): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new ValidationError([{ path, message: `Expected boolean, got ${typeof value}`, code: 'type' }]);
  }
}

// ── Date schema ─────────────────────────────────────────

export class DateSchema extends Schema<Date> {
  _parse(value: unknown, path: string[]): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new ValidationError([{ path, message: 'Invalid date', code: 'date' }]);
      }
      return date;
    }
    throw new ValidationError([{ path, message: `Expected date, got ${typeof value}`, code: 'type' }]);
  }
}

// ── Array schema ────────────────────────────────────────

export class ArraySchema<T> extends Schema<T[]> {
  constructor(private _itemSchema: Schema<T>) {
    super();
  }

  _parse(value: unknown, path: string[]): T[] {
    if (!Array.isArray(value)) {
      throw new ValidationError([{ path, message: `Expected array, got ${typeof value}`, code: 'type' }]);
    }
    const issues: ValidationIssue[] = [];
    const result: T[] = [];
    for (let i = 0; i < value.length; i++) {
      try {
        result.push(this._itemSchema.parse(value[i]));
      } catch (e) {
        if (e instanceof ValidationError) {
          for (const issue of e.issues) {
            issues.push({ ...issue, path: [...path, String(i), ...issue.path] });
          }
        } else {
          throw e;
        }
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);
    return result;
  }

  min(length: number): ArraySchema<T> {
    const original = this;
    const schema = new ArraySchema(this._itemSchema);
    const parentParse = schema._parse.bind(schema);
    schema._parse = (value: unknown, path: string[]) => {
      const result = parentParse(value, path);
      if (result.length < length) {
        throw new ValidationError([{ path, message: `Array must have at least ${length} items`, code: 'min_length' }]);
      }
      return result;
    };
    return schema;
  }
}

// ── Object schema ───────────────────────────────────────

type ObjectShape = Record<string, Schema<any>>;
type InferObject<S extends ObjectShape> = {
  [K in keyof S]: S[K] extends Schema<infer T> ? T : never;
};

export class ObjectSchema<S extends ObjectShape> extends Schema<InferObject<S>> {
  constructor(private _shape: S) {
    super();
  }

  _parse(value: unknown, path: string[]): InferObject<S> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ValidationError([{ path, message: `Expected object, got ${typeof value}`, code: 'type' }]);
    }
    const obj = value as Record<string, unknown>;
    const issues: ValidationIssue[] = [];
    const result: Record<string, any> = {};

    for (const [key, schema] of Object.entries(this._shape)) {
      try {
        result[key] = (schema as Schema<any>)['_parseRoot'](obj[key], [...path, key]);
      } catch (e) {
        if (e instanceof ValidationError) {
          issues.push(...e.issues);
        } else {
          throw e;
        }
      }
    }

    // Pass through unknown fields (don't strip them)
    for (const key of Object.keys(obj)) {
      if (!(key in this._shape)) {
        result[key] = obj[key];
      }
    }

    if (issues.length > 0) throw new ValidationError(issues);
    return result as InferObject<S>;
  }

  /** Return a new schema that strips unknown fields */
  strict(): ObjectSchema<S> {
    const clone = new ObjectSchema(this._shape);
    const parentParse = clone._parse.bind(clone);
    clone._parse = (value: unknown, path: string[]) => {
      const result = parentParse(value, path);
      // Remove unknown fields
      for (const key of Object.keys(result)) {
        if (!(key in clone._shape)) {
          delete (result as any)[key];
        }
      }
      return result;
    };
    return clone;
  }

  /** Merge with another object schema */
  merge<S2 extends ObjectShape>(other: ObjectSchema<S2>): ObjectSchema<S & S2> {
    return new ObjectSchema({ ...this._shape, ...other._shape } as S & S2);
  }

  /** Pick specific keys */
  pick<K extends keyof S>(...keys: K[]): ObjectSchema<Pick<S, K>> {
    const shape: any = {};
    for (const key of keys) {
      shape[key] = this._shape[key];
    }
    return new ObjectSchema(shape);
  }

  /** Omit specific keys */
  omit<K extends keyof S>(...keys: K[]): ObjectSchema<Omit<S, K>> {
    const shape: any = { ...this._shape };
    for (const key of keys) {
      delete shape[key];
    }
    return new ObjectSchema(shape);
  }

  /** Make all fields optional */
  partial(): ObjectSchema<{ [K in keyof S]: Schema<InferObject<S>[K] | undefined> }> {
    const shape: any = {};
    for (const [key, schema] of Object.entries(this._shape)) {
      shape[key] = (schema as Schema<any>).optional();
    }
    return new ObjectSchema(shape);
  }
}

// ── Enum schema ─────────────────────────────────────────

export class EnumSchema<T extends string> extends Schema<T> {
  constructor(private _values: readonly T[]) {
    super();
  }

  _parse(value: unknown, path: string[]): T {
    if (typeof value !== 'string' || !this._values.includes(value as T)) {
      throw new ValidationError([{
        path,
        message: `Expected one of: ${this._values.join(', ')}`,
        code: 'enum',
      }]);
    }
    return value as T;
  }
}

// ── Literal schema ──────────────────────────────────────

export class LiteralSchema<T extends string | number | boolean> extends Schema<T> {
  constructor(private _value: T) {
    super();
  }

  _parse(value: unknown, path: string[]): T {
    if (value !== this._value) {
      throw new ValidationError([{
        path,
        message: `Expected ${JSON.stringify(this._value)}, got ${JSON.stringify(value)}`,
        code: 'literal',
      }]);
    }
    return value as T;
  }
}

// ── Schema builder (the `z` object) ─────────────────────

export const z = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  date: () => new DateSchema(),
  array: <T>(item: Schema<T>) => new ArraySchema(item),
  object: <S extends ObjectShape>(shape: S) => new ObjectSchema(shape),
  enum: <T extends string>(values: readonly T[]) => new EnumSchema(values),
  literal: <T extends string | number | boolean>(value: T) => new LiteralSchema(value),
};

// ── Type inference helper ───────────────────────────────

export type Infer<S extends Schema<any>> = S extends Schema<infer T> ? T : never;

// Re-export z.infer style
export namespace z {
  export type infer<S extends Schema<any>> = Infer<S>;
}
