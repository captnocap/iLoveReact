/**
 * useAsyncResource — `{ data, loading, error, refetch }` for an async
 * fetcher. Replaces the data + loading + error + version + cancelled
 * quartet inlined in useCRUD, useMedia (6×), useBrowse, useEmbed.
 *
 * @example
 *   const users = useAsyncResource(() => fetch('/api/users').then(r => r.json()), [pageNum]);
 *   if (users.loading) return <Spinner />;
 *   if (users.error) return <Err msg={users.error.message} />;
 *   return <List items={users.data ?? []} onRefresh={users.refetch} />;
 *
 * Semantics that match every inlined copy I migrated:
 *   - Calls `fetcher` on mount + whenever `deps` change + whenever `refetch()` runs.
 *   - Initial state: { data: null, loading: true, error: null }.
 *   - In-flight requests are race-protected: if the component unmounts or
 *     deps change before the promise resolves, the result is discarded.
 *   - `error` and `data` are independent: a failed refetch keeps the
 *     previous data so the UI doesn't blank.
 */
import { useCallback, useEffect, useState } from 'react';

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);
  return { data, loading, error, refetch };
}
