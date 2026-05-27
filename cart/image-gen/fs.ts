// File-system helpers for prompts, img2img, and generated_images directories.
// Uses framework host functions directly (no Node.js fs module).

import { callHost, callHostJson, hasHost } from '../../runtime/ffi';

function readFile(path: string): string | null {
  if (!hasHost('__fs_readfile')) return null;
  return callHost<string | null>('__fs_readfile', null, path);
}

function writeFile(path: string, data: string): boolean {
  if (!hasHost('__fs_writefile')) return false;
  return callHost<boolean>('__fs_writefile', false, path, data);
}

function listDir(path: string): Array<{ name: string; type: 'file' | 'dir' }> {
  if (!hasHost('__fs_list_json')) return [];
  try {
    return callHostJson<Array<{ name: string; type: 'file' | 'dir' }>>('__fs_list_json', [], path);
  } catch {
    return [];
  }
}

function exists(path: string): boolean {
  if (!hasHost('__fs_exists')) return false;
  return callHost<boolean>('__fs_exists', false, path);
}

function mkdir(path: string): boolean {
  if (!hasHost('__fs_mkdir')) return false;
  return callHost<boolean>('__fs_mkdir', false, path);
}

// ── Paths ──

const BASE_DIR = './cart/image-gen/data';
export const PROMPTS_DIR = `${BASE_DIR}/prompts`;
export const IMG2IMG_DIR = `${BASE_DIR}/img2img`;
export const OUTPUT_DIR = `${BASE_DIR}/generated_images`;
export const QUEUE_FILE = `${BASE_DIR}/queue.txt`;

export function ensureDirectories(): void {
  mkdir(BASE_DIR);
  mkdir(PROMPTS_DIR);
  mkdir(IMG2IMG_DIR);
  mkdir(OUTPUT_DIR);
}

// ── Prompts ──

export function listPromptFiles(): string[] {
  const entries = listDir(PROMPTS_DIR);
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.txt'))
    .map((e) => e.name.replace('.txt', ''))
    .sort();
}

export function loadPromptFile(name: string): string | null {
  return readFile(`${PROMPTS_DIR}/${name}.txt`);
}

export function savePromptFile(name: string, text: string): boolean {
  return writeFile(`${PROMPTS_DIR}/${name}.txt`, text);
}

export function deletePromptFile(name: string): boolean {
  if (!hasHost('__fs_deletefile')) return false;
  return callHost<boolean>('__fs_deletefile', false, `${PROMPTS_DIR}/${name}.txt`);
}

// ── Img2Img ──

export interface Img2ImgJson {
  base64: string;
}

export function listImg2ImgFiles(): string[] {
  const entries = listDir(IMG2IMG_DIR);
  return entries
    .filter((e) => e.type === 'file' && (e.name.endsWith('.json') || e.name.endsWith('.png') || e.name.endsWith('.jpg') || e.name.endsWith('.jpeg') || e.name.endsWith('.webp')))
    .map((e) => e.name)
    .sort();
}

export function loadImg2ImgJson(name: string): Img2ImgJson | null {
  const raw = readFile(`${IMG2IMG_DIR}/${name}.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Img2ImgJson;
  } catch {
    return null;
  }
}

export function saveImg2ImgJson(name: string, base64: string): boolean {
  return writeFile(`${IMG2IMG_DIR}/${name}.json`, JSON.stringify({ base64 }, null, 2));
}

export function listImg2ImgDirs(): string[] {
  const entries = listDir(IMG2IMG_DIR);
  return entries.filter((e) => e.type === 'dir').map((e) => e.name);
}

export function listImg2ImgInDir(dirName: string): string[] {
  const entries = listDir(`${IMG2IMG_DIR}/${dirName}`);
  return entries
    .filter((e) => e.type === 'file' && (/\.(png|jpg|jpeg|webp|json)$/i).test(e.name))
    .map((e) => e.name.replace(/\.[^.]+$/, ''));
}

// ── Queue ──

export function loadQueueFile(): string {
  const raw = readFile(QUEUE_FILE);
  return raw ?? '';
}

export function saveQueueFile(content: string): boolean {
  return writeFile(QUEUE_FILE, content);
}

// ── Generated images ──

export function listGeneratedImages(): string[] {
  const entries = listDir(OUTPUT_DIR);
  return entries
    .filter((e) => e.type === 'file' && (/\.(png|jpg|jpeg|webp)$/i).test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export function generatedImagePath(filename: string): string {
  return `${OUTPUT_DIR}/${filename}`;
}
