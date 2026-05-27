// transport.ts — default HTTP transport for source adapters.
//
// Adapters take an injectable HttpGet (see types.ts) so tests can feed
// captured responses without the runtime FFI network — that only exists
// inside the full app, not under tools/v8cli. Production wiring passes
// defaultHttpGet, which routes through the runtime fetch hook.

import { getAsync } from '@reactjit/runtime/hooks/fetch';
import type { HttpGet } from './types';

export const defaultHttpGet: HttpGet = async (url, headers) => {
  const r = await getAsync(url, headers);
  return { status: r.status, body: r.body };
};
