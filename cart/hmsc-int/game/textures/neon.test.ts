// neon (req_0893 #2 / req_0899) — the SVG → neon decal import: a whole
// multi-<path> SVG OR a single `d`, fit to the canvas, one glowing node per path.

import { assert, assertEqual, finish, test } from '../_testkit';
import { extractSvgPaths, parseSvgColor, neonDecalDoc } from './neon';

const SAMPLE_SVG = `
  <path d="M1159.48 414.708 C1160.47 407.29 1161.21 401.377 1163.47 3.7 z" fill="rgb(6,3,3)" transform="translate(0,0)"></path>
  <path d="M1220.86 350.959 L1235.18 350.882 C1256.63 355.267 1266.4 417.631 z" fill="rgb(6,25,217)"></path>
  <path d="M1338.86 735.536 L1344.02 735.849 z" fill="rgb(2,11,73)"></path>
`;

test('parseSvgColor normalizes rgb()/hex; none → null', () => {
  assertEqual(parseSvgColor('rgb(6,25,217)'), '#0619d9', 'rgb → #rrggbb');
  assertEqual(parseSvgColor('rgb(6,3,3)'), '#060303', 'small rgb pads');
  assertEqual(parseSvgColor('#FA0'), '#ffaa00', '#rgb expands');
  assertEqual(parseSvgColor('none'), null, 'none → null');
  assertEqual(parseSvgColor(''), null, 'empty → null');
});

test('extractSvgPaths pulls every <path> with its fill; a bare d is one path', () => {
  const paths = extractSvgPaths(SAMPLE_SVG);
  assertEqual(paths.length, 3, 'three <path> elements');
  assertEqual(paths[1].fill, '#0619d9', 'each path keeps its parsed fill');
  const bare = extractSvgPaths('M10,10 L90,90 L10,90 Z');
  assertEqual(bare.length, 1, 'a bare d is a single path');
  assertEqual(bare[0].fill, null, 'a bare d has no fill');
});

test('neonDecalDoc fits the WHOLE logo into the canvas (no off-origin black)', () => {
  const doc = neonDecalDoc(SAMPLE_SVG);
  assert(doc.nodes.length === 3, 'one node per path');
  // every coordinate in every node must land inside the canvas — the framing fix
  // (the user pasted coords ~700-1400; the old max-coord sizing left them tiny).
  for (const node of doc.nodes) {
    assertEqual(node.kind, 'path', 'path node');
    const nums = (node.kind === 'path' ? node.d : '').match(/[-+]?\d*\.?\d+/g) ?? [];
    for (const n of nums) {
      const v = Number(n);
      assert(v >= -1 && v <= doc.width + 1, `coord ${v} is within the ${doc.width}px canvas`);
    }
  }
  // blank color → each node keeps its logo fill; explicit color overrides all.
  if (doc.nodes[1].kind === 'path') assertEqual(doc.nodes[1].stroke, '#0619d9', 'node wears its fill when no override');
  const mono = neonDecalDoc(SAMPLE_SVG, { stroke: '#ff3bd0' });
  if (mono.nodes[0].kind === 'path') assertEqual(mono.nodes[0].stroke, '#ff3bd0', 'explicit color overrides every path');
});

finish('textures/neon');
