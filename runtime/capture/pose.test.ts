import { POSE_KEYPOINT_NAMES, parsePoseReply } from './pose';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const triples = POSE_KEYPOINT_NAMES.flatMap((_, i) => [i / 20, i / 25, 0.9]);
const parsed = parsePoseReply(JSON.stringify({ ok: true, kp: triples, elapsed_ms: 63 }));
assert(!('error' in parsed), 'successful worker payload parses');
assert(parsed.keypoints.length === 17, 'all COCO keypoints cross the bridge');
assert(parsed.keypoints[0]!.name === 'nose', 'COCO order is stable');
assert(parsed.keypoints[16]!.name === 'ankle_right', 'COCO tail is stable');
assert(parsed.keypoints[10]!.x === 0.5, 'worker triples map to the matching keypoint');
assert(parsed.elapsedMs === 63, 'worker timing survives the bridge');

const failed = parsePoseReply('{"ok":false,"error":"model unavailable"}');
assert('error' in failed && failed.error === 'model unavailable', 'worker errors stay explicit');
assert('error' in parsePoseReply('not-json'), 'malformed payload fails closed');

console.log('pose bridge: 8 assertions passed');
