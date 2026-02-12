// ── Storage adapter interface ────────────────────────────

export type StorageFormat = 'json' | 'markdown' | 'text';

export interface StorageAdapter {
  get(collection: string, id: string): Promise<any | null>;
  set(collection: string, id: string, data: any): Promise<void>;
  delete(collection: string, id: string): Promise<boolean>;
  list(collection: string, query?: Query): Promise<any[]>;
  format?: StorageFormat;
}

// ── Query types ─────────────────────────────────────────

export type ComparisonOp = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$contains';

export type WhereClause = Record<string, any | Partial<Record<ComparisonOp, any>>>;

export interface Query {
  where?: WhereClause;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// ── Migration types ─────────────────────────────────────

export type MigrationFn = (data: any) => any;

export interface MigrationConfig {
  migrations?: Record<number, MigrationFn>;
  autoMigrate?: boolean;
}

// ── CRUD hook types ─────────────────────────────────────

export interface CRUDHandle<T> {
  create(data: T): Promise<string>;
  get(id: string): Promise<T | null>;
  update(id: string, partial: Partial<T>): Promise<void>;
  delete(id: string): Promise<void>;
  list(query?: Query): Promise<T[]>;
  useQuery(id: string): { data: T | null; loading: boolean; error: Error | null; refetch: () => void };
  useListQuery(query?: Query): { data: T[]; loading: boolean; error: Error | null; refetch: () => void };
}

export interface CRUDOptions {
  adapter?: StorageAdapter;
  format?: StorageFormat;
  migrations?: Record<number, MigrationFn>;
  autoMigrate?: boolean;
}

// ── Provider types ──────────────────────────────────────

export interface StorageProviderProps {
  adapter: StorageAdapter;
  children: React.ReactNode;
}
