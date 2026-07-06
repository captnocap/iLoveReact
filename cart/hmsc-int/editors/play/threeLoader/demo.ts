import * as THREE from 'three';
import { loadHmscThreeFromGameFile, loadHmscThreeFromMapContainer } from './load';

type LoadMode = 'gamefile' | 'map';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const notesEl = document.querySelector<HTMLDivElement>('#notes');
const pathInput = document.querySelector<HTMLInputElement>('#path');
const loadButton = document.querySelector<HTMLButtonElement>('#load');
const fileInput = document.querySelector<HTMLInputElement>('#file');
const modeSelect = document.querySelector<HTMLSelectElement>('#mode');
const statsEl = document.querySelector<HTMLDivElement>('#stats');

if (!canvas || !statusEl || !notesEl || !pathInput || !loadButton || !fileInput || !modeSelect || !statsEl) {
  throw new Error('threeLoader demo markup is incomplete');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x090d12, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x090d12, 300, 1800);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
const ambient = new THREE.AmbientLight(0xffffff, 0.65);
const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(120, 180, 80);
scene.add(ambient, sun);

const grid = new THREE.GridHelper(400, 40, 0x395163, 0x1a2530);
grid.position.y = -0.02;
scene.add(grid);

let loadedGroup: THREE.Object3D | null = null;
let target = new THREE.Vector3(0, 0, 0);
let yaw = -0.75;
let pitch = -0.45;
let distance = 180;
let pointer: { x: number; y: number } | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setNotes(notes: string[]): void {
  notesEl.textContent = notes.length ? notes.join('\n') : '';
}

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function updateCamera(): void {
  const cp = Math.cos(pitch);
  camera.position.set(
    target.x + Math.sin(yaw) * cp * distance,
    target.y + Math.sin(-pitch) * distance + 24,
    target.z + Math.cos(yaw) * cp * distance,
  );
  camera.lookAt(target);
}

function frameLoadedGroup(group: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) {
    target.set(0, 0, 0);
    distance = 160;
    return;
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(target);
  const maxAxis = Math.max(size.x, size.y, size.z, 20);
  distance = Math.max(80, Math.min(2400, maxAxis * 0.9));
}

function mount(group: THREE.Object3D): void {
  if (loadedGroup) scene.remove(loadedGroup);
  loadedGroup = group;
  scene.add(group);
  frameLoadedGroup(group);
  updateCamera();
}

function applyEnvironment(group: THREE.Object3D): void {
  const env = (group.userData as any)?.hmscCompiledScene?.environment;
  if (!env) return;
  ambient.color.setRGB(env.ambientColor[0], env.ambientColor[1], env.ambientColor[2]);
  ambient.intensity = env.ambientIntensity;
  sun.color.setRGB(env.dirColor[0], env.dirColor[1], env.dirColor[2]);
  sun.intensity = env.dirIntensity;
  sun.position.set(env.dir[0], env.dir[1], env.dir[2]).normalize().multiplyScalar(160);
  if (env.camFov > 10) {
    camera.fov = env.camFov;
    camera.updateProjectionMatrix();
  }
}

async function loadBytes(bytes: Uint8Array, mode: LoadMode, label: string): Promise<void> {
  const t0 = performance.now();
  const result = mode === 'map'
    ? loadHmscThreeFromMapContainer(THREE, bytes, { name: label })
    : loadHmscThreeFromGameFile(THREE, bytes, { name: label });
  const elapsed = performance.now() - t0;
  mount(result.group);
  applyEnvironment(result.group);
  const s = result.stats;
  statsEl.textContent = [
    `${s.renderedInstances.toLocaleString()} / ${s.instances.toLocaleString()} instances`,
    `${s.instancedMeshes} Three instanced mesh batches`,
    `${s.heightfields} heightfields`,
    `${s.skippedInstances} skipped`,
    `${elapsed.toFixed(1)}ms load`,
  ].join(' | ');
  setNotes(result.notes);
  setStatus(`loaded ${label}`);
}

async function loadPath(): Promise<void> {
  const path = pathInput.value.trim();
  if (!path) return;
  setStatus(`loading ${path}`);
  setNotes([]);
  statsEl.textContent = '';
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await loadBytes(bytes, modeSelect.value as LoadMode, path);
}

loadButton.addEventListener('click', () => {
  loadPath().catch((error) => {
    setStatus(`load failed: ${error?.message ?? String(error)}`);
  });
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setStatus(`loading ${file.name}`);
  file.arrayBuffer()
    .then((buffer) => loadBytes(new Uint8Array(buffer), modeSelect.value as LoadMode, file.name))
    .catch((error) => setStatus(`load failed: ${error?.message ?? String(error)}`));
});

canvas.addEventListener('pointerdown', (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer = { x: event.clientX, y: event.clientY };
  yaw -= dx * 0.006;
  pitch = Math.max(-1.25, Math.min(0.05, pitch - dy * 0.004));
  updateCamera();
});

canvas.addEventListener('pointerup', () => {
  pointer = null;
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  distance = Math.max(20, Math.min(6000, distance * (event.deltaY > 0 ? 1.12 : 0.88)));
  updateCamera();
}, { passive: false });

window.addEventListener('resize', () => {
  resize();
  updateCamera();
});

resize();
updateCamera();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

loadPath().catch((error) => {
  setStatus(`waiting for gamefile: ${error?.message ?? String(error)}`);
});
