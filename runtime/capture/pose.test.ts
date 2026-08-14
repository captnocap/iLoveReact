import { POSE_LANDMARK_NAMES, parsePoseCameraDevicesReply, parsePoseReply } from './pose';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const triples = POSE_LANDMARK_NAMES.flatMap((_, i) => [i / 40, i / 50, 0.9]);
const world = POSE_LANDMARK_NAMES.flatMap((_, i) => [i / 100, -i / 100, 0.01 * i]);
const parsed = parsePoseReply(JSON.stringify({ ok: true, presence: 0.98, kp: triples, world }));
assert(!('error' in parsed), 'successful solve payload parses');
assert(parsed.landmarks.length === 33, 'all 33 BlazePose landmarks cross the bridge');
assert(parsed.landmarks[0]!.name === 'nose', 'landmark order is stable');
assert(parsed.landmarks[32]!.name === 'foot_index_right', 'landmark tail is stable');
assert(parsed.landmarks[10]!.x === 0.25, 'triples map to the matching landmark');
assert(parsed.landmarks[10]!.world[1] === -0.1, 'metric world positions survive the bridge');
assert(parsed.presence === 0.98, 'pose presence survives the bridge');

const failed = parsePoseReply('{"ok":false,"error":"model unavailable"}');
assert('error' in failed && failed.error === 'model unavailable', 'solve errors stay explicit');
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

console.log('pose bridge: 15 assertions passed');
