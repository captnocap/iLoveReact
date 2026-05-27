// smoke.ts — offline smoke test for the source adapters.
//
// Repro:  bash cart/composer/sources/smoke.sh
//
// tools/v8cli is bare V8: no FFI network and no URLSearchParams. So we
// (a) polyfill URLSearchParams + queueMicrotask, (b) inject a fixture
// HttpGet built from REAL responses captured live on 2026-05-23 (Internet
// Archive search + metadata; Freesound/Jamendo are hand-built from their
// documented shapes since searching them needs API keys). This exercises the
// full search() / resolveDownload() → normalize path without the network.

// ── bare-V8 polyfills ───────────────────────────────────────────────
const G = globalThis as any;
if (typeof G.queueMicrotask === 'undefined') {
  G.queueMicrotask = (fn: () => void) => { Promise.resolve().then(fn); };
}
if (typeof G.URLSearchParams === 'undefined') {
  class USP {
    private pairs: Array<[string, string]> = [];
    constructor(init?: Record<string, string>) {
      if (init) for (const k of Object.keys(init)) this.pairs.push([k, String(init[k])]);
    }
    set(k: string, v: string) { this.pairs = this.pairs.filter((p) => p[0] !== k); this.pairs.push([k, String(v)]); }
    append(k: string, v: string) { this.pairs.push([k, String(v)]); }
    toString() { return this.pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); }
  }
  G.URLSearchParams = USP;
}

import { createFreesoundAdapter } from './freesound';
import { createJamendoAdapter } from './jamendo';
import { createInternetArchiveAdapter } from './internet_archive';
import { credentials } from './credentials';
import type { HttpGet } from './types';

// ── fixtures ────────────────────────────────────────────────────────
// Internet Archive — REAL, captured live (note: doc[0].subject is a STRING,
// doc[2].subject is an ARRAY — the coercion case we care about).
const IA_SEARCH = JSON.stringify({
  responseHeader: { status: 0 },
  response: {
    numFound: 1285, start: 0, docs: [
      { creator: 'The KingDeep', identifier: 'h8p1ypadcyblqiudwumv1fn4ohmwftcsjckyfzcb', subject: 'Podcast', title: 'LRC Presents The Listening Session EP003' },
      { creator: 'Miami Valley UU Fellowship', identifier: 'Miami_Valley_UU-20221218', subject: 'reason and sound thinking', title: 'Finding Joy in Troubled Times' },
      { creator: 'ultimathule.info', identifier: 'ultima-thule-1404', subject: ['ambient', 'music', 'podcast', 'radio', 'ultima-thule'], title: 'Ultima Thule #1404' },
    ],
  },
});
// IA metadata — REAL, trimmed to fields the mapper reads (+ non-audio files
// to verify the audio filter). No licenseurl → family 'unknown'.
const IA_META = JSON.stringify({
  metadata: { identifier: 'ultima-thule-1404', title: 'Ultima Thule #1404', creator: 'ultimathule.info' },
  files: [
    { name: 'UT_1404_56k.mp3', format: 'VBR MP3', size: '37423200', length: '5344.92' },
    { name: '__ia_thumb.jpg', format: 'Item Tile', size: '12345' },
    { name: 'UT_1404_meta.xml', format: 'Metadata' },
  ],
});
// Freesound — crafted from the documented sound-instance shape.
const FS_SEARCH = JSON.stringify({
  count: 1, next: null, previous: null, results: [
    {
      id: 12345, name: 'Tight Kick 01', tags: ['kick', 'drum', '808'], description: 'A punchy kick',
      license: 'Creative Commons 0', type: 'wav', channels: 2, duration: 0.42, samplerate: 44100, filesize: 74088,
      username: 'drummer', url: 'https://freesound.org/s/12345/',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/12/12345_hq.mp3', 'preview-lq-mp3': 'https://cdn.freesound.org/previews/12/12345_lq.mp3' },
      download: 'https://freesound.org/apiv2/sounds/12345/download/', ai_preference: 'open-models',
    },
  ],
});
// Jamendo — crafted success envelope (real error envelope was verified live).
const JAMENDO_SEARCH = JSON.stringify({
  headers: { status: 'success', code: 0, results_count: 1 },
  results: [
    {
      id: '168', name: 'Guitar Riff', duration: 183, artist_name: 'Some Artist', artist_id: '42',
      audio: 'https://prod-1.storage.jamendo.com/?trackid=168&format=mp31',
      audiodownload: 'https://prod-1.storage.jamendo.com/download/track/168/mp32/',
      audiodownload_allowed: true, license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/',
      shareurl: 'https://www.jamendo.com/track/168',
      musicinfo: { tags: { genres: ['rock'], instruments: ['guitar'], vartags: ['energetic'] } },
    },
  ],
});

const fixtureHttp: HttpGet = async (url) => {
  if (url.includes('advancedsearch')) return { status: 200, body: IA_SEARCH };
  if (url.includes('/metadata/')) return { status: 200, body: IA_META };
  if (url.includes('freesound.org/apiv2/search')) return { status: 200, body: FS_SEARCH };
  if (url.includes('api.jamendo.com')) return { status: 200, body: JAMENDO_SEARCH };
  return { status: 404, body: '{}' };
};

// Freesound + Jamendo need a token even to build a request — stub it. The
// standalone getToken() the adapters import delegates to credentials.getToken,
// so overriding this one method is enough.
credentials.getToken = () => 'TEST-KEY';

// ── tiny assert harness ─────────────────────────────────────────────
let pass = 0; let fail = 0; const lines: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; lines.push(`  PASS  ${name}`); }
  else { fail++; lines.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
function out(s: string) {
  if (G.console && G.console.log) G.console.log(s);
  else if (typeof G.print === 'function') G.print(s);
  else if (typeof G.__writeStdout === 'function') G.__writeStdout(s + '\n');
}

async function main() {
  // ── Internet Archive (no auth) ──
  const ia = createInternetArchiveAdapter(fixtureHttp);
  const iaPage = await ia.search({ text: 'piano loop', pageSize: 3 });
  check('IA returns 3 items', iaPage.items.length === 3, `got ${iaPage.items.length}`);
  check('IA totalCount = 1285', iaPage.totalCount === 1285, String(iaPage.totalCount));
  check('IA nextCursor advances', iaPage.nextCursor === '2', String(iaPage.nextCursor));
  const podcast = iaPage.items[0];
  check('IA subject STRING → 1 tag', podcast.tags.length === 1, `${podcast.tags.length}`);
  const ut = iaPage.items.find((i) => i.sourceId === 'ultima-thule-1404');
  check('IA finds ultima item', !!ut);
  check('IA subject ARRAY → 5 tags', !!ut && ut.tags.length === 5, ut ? `${ut.tags.length}` : 'n/a');
  check('IA license unknown (no licenseurl)', !!ut && ut.license.family === 'unknown');
  check('IA search-time original is null', !!ut && ut.original === null);
  check('IA sourceUrl built', !!ut && ut.sourceUrl === 'https://archive.org/details/ultima-thule-1404');
  if (ut) {
    const dl = await ia.resolveDownload(ut); // triggers fixture /metadata/ lookup
    check('IA resolveDownload picks the mp3', !!dl && dl.url.endsWith('/ultima-thule-1404/UT_1404_56k.mp3'), dl ? dl.url : 'null');
    check('IA resolveDownload format = mp3', !!dl && dl.sourceFormat === 'mp3');
    const byId = await ia.getById('ultima-thule-1404');
    check('IA getById parses length 5344.92', !!byId && byId.audio.durationSec === 5344.92, byId ? String(byId.audio.durationSec) : 'null');
  }

  // ── Freesound ──
  const fs = createFreesoundAdapter(fixtureHttp);
  const fsPage = await fs.search({ text: 'kick', pageSize: 2 });
  check('FS returns 1 item', fsPage.items.length === 1);
  const k = fsPage.items[0];
  check('FS license = cc0', !!k && k.license.family === 'cc0', k ? k.license.family : 'n/a');
  check('FS allowsCommercial', !!k && k.license.allowsCommercial === true);
  check('FS format = wav', !!k && k.audio.format === 'wav');
  check('FS duration = 0.42', !!k && k.audio.durationSec === 0.42);
  check('FS preview = hq mp3', !!k && !!k.preview && k.preview.url.includes('12345_hq.mp3'));
  check('FS requires auth for original', !!k && k.requiresAuthToDownload === true);
  if (k) {
    const fdl = await fs.resolveDownload(k);
    check('FS resolveDownload → preview mp3', !!fdl && fdl.sourceFormat === 'mp3' && fdl.url.includes('12345_hq.mp3'));
  }

  // ── Jamendo ──
  const jam = createJamendoAdapter(fixtureHttp);
  const jPage = await jam.search({ text: 'guitar', pageSize: 2 });
  check('Jamendo returns 1 item', jPage.items.length === 1);
  const t = jPage.items[0];
  check('Jamendo license = cc-by-nc-sa', !!t && t.license.family === 'cc-by-nc-sa', t ? t.license.family : 'n/a');
  check('Jamendo non-commercial', !!t && t.license.allowsCommercial === false);
  check('Jamendo tags flattened', !!t && t.tags.includes('rock') && t.tags.includes('guitar') && t.tags.includes('energetic'));
  check('Jamendo original set (dl allowed)', !!t && !!t.original);
  check('Jamendo preview = stream', !!t && !!t.preview && t.preview.url.includes('format=mp31'));
  if (t) {
    const jdl = await jam.resolveDownload(t);
    check('Jamendo resolveDownload → original', !!jdl && jdl.url.includes('/download/'));
  }
  const jPage2 = await jam.search({ text: 'guitar', commercialUseOnly: true });
  check('Jamendo commercialUseOnly drops NC track', jPage2.items.length === 0, `${jPage2.items.length}`);

  out('\n── source adapter smoke ──\n' + lines.join('\n') + `\n\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0 && G.process && typeof G.process.exit === 'function') G.process.exit(1);
}

main().catch((e) => { out('SMOKE ERROR: ' + ((e && e.stack) || String(e))); });
