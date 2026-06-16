// editors/model/textureGen.ts — Phase 5d: the AI texture-fill core (USER req_1070/
// req_1110/req_1113). The manual loop (export slice → external model → import slice)
// is automated here.
//
// TWO surfaces, kept apart (the req_1070 ruling):
//   • PIXELS  — image generation is a plain HTTP POST. REUSES cart/image-gen's
//               nano-gpt client (`generateToBase64`, the rule-of-two network half):
//               img2img via `imageDataUrls`, b64_json back, key from getActiveApiKey.
//   • WORDS   — prompt enhancement is OPTIONAL and routes EITHER to a nano-gpt TEXT
//               model (same key, OpenAI-compatible /v1/chat/completions — req_1113)
//               OR to Claude via the useAssistant worker (handled in the dialog).
//               The bypass toggle sends the raw prompt with no enhancement.
//
// This module is the pure + network core; the dialog (Studio.tsx) owns the UI and the
// Claude worker. See ../MESH_EDITOR_PLAYBOOK.md 5.6b.

import { postAsync } from '@reactjit/hooks/fetch';
import { nsGet, nsSet } from '@reactjit/hooks/localstore';
import { generateToBase64 } from '../../../image-gen/client';
import type { JobOptions } from '../../../image-gen/config';

/** nano-gpt's OpenAI-compatible chat endpoint (text models) — same host + key as the
 *  image endpoint, different auth header (Bearer vs the image endpoint's x-api-key). */
const NANO_CHAT_URL = 'https://nano-gpt.com/api/v1/chat/completions';

// The nano-gpt API key lives NATIVELY in hmsc-int's OWN localstore (req_1118 — all
// in-house), NOT the image-gen app's Postgres store. The one key powers both the image
// endpoint and the text-enhance endpoint. Using localstore (the 'hmsc' namespace the
// editor already uses) means no Postgres bindings and no dev-host rebuild.
const KEY_NS = 'hmsc';
const KEY_NAME = 'nano-gpt-api-key';
export function getNanoKey(): string { return nsGet(KEY_NS, KEY_NAME) || ''; }
export function setNanoKey(value: string): void { nsSet(KEY_NS, KEY_NAME, value.trim()); }

/** Strip a `data:image/...;base64,` prefix down to the raw base64 (pass-through if
 *  already bare). The atlas stores re-uploads as data URLs; img2img wants the bytes. */
export function stripDataUrl(s: string): string {
  const i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 7) : s;
}

/** Wrap raw base64 PNG bytes as a data URL the atlas <Image> can sample directly. */
export function pngDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}

/** A short stable hex digest of a string (FNV-1a 32-bit + length) — content-addresses
 *  the cache file for a large texture so its <Image source> path changes with content
 *  (the host image cache is keyed on the source bytes; a reused path would go stale). */
export function hashHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}

/** Fold the part/scene name into the user's words so the model knows what it textures. */
export function buildTexturePrompt(target: string, userText: string): string {
  const t = userText.trim();
  if (!target) return t;
  return t ? `Texture for "${target}": ${t}` : `Texture for "${target}"`;
}

/** The enhancement system prompt — turn a short description into a flat-texture prompt
 *  (one atlas island/sheet of a low-poly model, even lighting, no scene/perspective). */
export const ENHANCE_SYSTEM =
  'You expand a short description into a detailed prompt for an image model that ' +
  'generates a flat TEXTURE for one piece of a low-poly 3D game model — a texture ' +
  'atlas island painted flat, even lighting, tileable where it makes sense, NO 3D ' +
  'scene, NO perspective, NO background, NO drop shadows. Reply with ONLY the expanded ' +
  'prompt text — no preamble, no quotes, no commentary.';

/** Enhance a prompt via a nano-gpt TEXT model (same API key as the image endpoint). */
export async function enhanceViaNano(userPrompt: string, model: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('add your nano-gpt API key first');
  const m = model.trim();
  if (!m) throw new Error('enter a text model id (e.g. openai/gpt-5.1)');
  const body = JSON.stringify({
    model: m,
    messages: [
      { role: 'system', content: ENHANCE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  });
  const res = await postAsync(NANO_CHAT_URL, body, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`text model failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  let data: any;
  try { data = JSON.parse(res.body); } catch { throw new Error('text model reply is not JSON'); }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('text model returned no content');
  return content.trim();
}

/** Generate ONE texture image via the nano-gpt image client. img2img when a reference
 *  base64 is given (the current atlas art); text-to-image when it's null. Returns the
 *  raw base64 PNG (no data URL). `size` is the requested square resolution — kept at
 *  the atlas scale, NOT the model's 4096² default, so results stay light. */
export async function generateTexture(prompt: string, imageModel: string, size: number, refB64: string | null, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error('add your nano-gpt API key first');
  const options: JobOptions = {
    model: imageModel.trim() || undefined,
    numImages: 1,
    width: size,
    height: size,
  };
  const refs = refB64 ? [refB64] : [];
  const out = await generateToBase64(prompt, options, apiKey, refs);
  if (!out.length) throw new Error('image model returned no image');
  return out[0];
}
