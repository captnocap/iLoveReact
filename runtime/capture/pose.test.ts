import { POSE_KEYPOINT_NAMES, parsePoseCameraDevicesReply, parsePoseReply } from './pose';

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

const cameras = parsePoseCameraDevicesReply(JSON.stringify({
  ok: true,
  devices: [
    { index: 2, source: '/dev/video2', name: 'OBSBOT Tiny 2', driver: 'uvcvideo', bus: 'usb-2' },
    { index: 3, source: '/dev/video3', name: '', driver: 'uvcvideo', bus: 'usb-2' },
    { index: 0, source: '/dev/video0', name: 'USB3 Video', driver: 'uvcvideo', bus: 'usb-1' },
    { index: 99, source: '/dev/video0', name: 'mismatch', driver: '', bus: '' },
  ],
}));
assert(cameras.length === 2, 'invalid, duplicate, and nameless camera rows are filtered');
assert(cameras[0]!.source === '/dev/video0', 'camera devices sort by node index');
assert(cameras[1]!.source === '/dev/video2', 'second usable capture node survives');
assert(cameras[1]!.name === 'OBSBOT Tiny 2', 'hardware card name survives the bridge');
assert(parsePoseCameraDevicesReply('not-json').length === 0, 'malformed discovery fails closed');
assert(parsePoseCameraDevicesReply('{"ok":false,"devices":[]}').length === 0, 'host discovery error fails closed');

console.log('pose bridge: 14 assertions passed');
