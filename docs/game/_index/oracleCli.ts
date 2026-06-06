// oracleCli.ts — `tools/oracle`'s entry (run under tools/v8cli; argv =
// [script, ...query words]). Split from oracle.ts so the search module stays
// side-effect-free for importers (requests.test.ts, future tooling).

import { oracle } from './oracle';

declare const process: { argv: string[] } | undefined;

const argv = typeof process !== 'undefined' ? process.argv.slice(1) : [];
console.log(oracle(argv.join(' ')));
