// Avatar — gallery data shape for the visual entity.
//
// Decoupled from Character (the assistant's voice configuration).
// Every <Avatar> the runtime renders is one of these rows. An avatar
// can belong to a Character, to the User, or be a free scene prop.
//
// Mirrors `runtime/avatar/types.ts`. Two declarations on purpose —
// runtime/ stays free of cart/ imports, and cart/ defines the
// gallery-shaped row schema with mock data + references.
//
// ── What's *not* on this row yet ─────────────────────────────────
// Outfits, poses, emotes, wardrobe entries — all deferred. The first
// pass keeps just the parts list so every consumer (chat bust portrait,
// character creator preview, the eventual /avatar wardrobe) can render
// against the same primitive. Animation / pose deltas land on a
// sibling shape (`avatar-pose.ts`) when the rig system surfaces.

import type { GalleryDataReference, JsonObject } from '../../types';

export type AvatarPartKind =
  | 'head'
  | 'crown'
  | 'halo'
  | 'torso'
  | 'arm-left'
  | 'arm-right'
  | 'hand-left'
  | 'hand-right'
  | 'waist'
  | 'leg-left'
  | 'leg-right'
  | 'foot-left'
  | 'foot-right'
  | 'prop'
  | 'accessory';

export type AvatarGeometry = 'box' | 'sphere' | 'plane' | 'torus' | 'cylinder' | 'cone';

export type Vec3 = [number, number, number];

export type AvatarPart = {
  id: string;
  kind: AvatarPartKind;
  geometry: AvatarGeometry;
  color: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  radius?: number;
  tubeRadius?: number;
  size?: Vec3;
  visible?: boolean;
};

export type AvatarOwnerKind = 'user' | 'character' | 'prop';

export type Avatar = {
  id: string;
  name: string;
  description?: string;
  ownerKind: AvatarOwnerKind;
  /** FK string keyed by ownerKind. Empty string when ownerKind = 'prop'. */
  ownerId: string;
  parts: AvatarPart[];
  createdAt: string;
  updatedAt: string;
};

const ts = '2026-05-02T00:00:00Z';

// ── The v1 "chunky mannequin" reference avatar ────────────────────────
//
// Same proportions as the cart/scene3d_lab tile 6 figure. Twelve parts
// total — head + crown + halo + torso + 2 arms + 2 hands + 2 legs + 2
// feet. No ground plane (that's a stage element, not part of the avatar).

export const avatarMockData: Avatar[] = [
  {
    id: 'avatar_default_sage',
    name: 'Sage (default)',
    description:
      'The v1 reference mannequin. Tan skin, blue shirt, dark-blue pants, yellow crown + halo. Used as the default avatar bound to char_default and as the lab\'s parts-taxonomy proof.',
    ownerKind: 'character',
    ownerId: 'char_default',
    parts: [
      // Head + crown + halo cluster (top)
      {
        id: 'head',
        kind: 'head',
        geometry: 'sphere',
        color: '#d9b48c',
        position: [0, 1.55, 0],
        radius: 0.35,
      },
      {
        id: 'crown',
        kind: 'crown',
        geometry: 'box',
        color: '#ffd66a',
        position: [0, 1.95, 0],
        size: [0.7, 0.12, 0.7],
      },
      {
        id: 'halo',
        kind: 'halo',
        geometry: 'torus',
        color: '#ffd66a',
        position: [0, 2.15, 0],
        rotation: [Math.PI / 2, 0, 0],
        radius: 0.30,
        tubeRadius: 0.03,
      },
      // Torso + arms (middle)
      {
        id: 'torso',
        kind: 'torso',
        geometry: 'box',
        color: '#4aa3ff',
        position: [0, 0.85, 0],
        size: [0.85, 1.1, 0.5],
      },
      {
        id: 'arm-left',
        kind: 'arm-left',
        geometry: 'box',
        color: '#4aa3ff',
        position: [-0.6, 0.85, 0],
        size: [0.22, 1.0, 0.32],
      },
      {
        id: 'arm-right',
        kind: 'arm-right',
        geometry: 'box',
        color: '#4aa3ff',
        position: [0.6, 0.85, 0],
        size: [0.22, 1.0, 0.32],
      },
      // Hands
      {
        id: 'hand-left',
        kind: 'hand-left',
        geometry: 'sphere',
        color: '#d9b48c',
        position: [-0.6, 0.20, 0],
        radius: 0.13,
      },
      {
        id: 'hand-right',
        kind: 'hand-right',
        geometry: 'sphere',
        color: '#d9b48c',
        position: [0.6, 0.20, 0],
        radius: 0.13,
      },
      // Legs
      {
        id: 'leg-left',
        kind: 'leg-left',
        geometry: 'box',
        color: '#26314a',
        position: [-0.22, -0.10, 0],
        size: [0.25, 1.05, 0.32],
      },
      {
        id: 'leg-right',
        kind: 'leg-right',
        geometry: 'box',
        color: '#26314a',
        position: [0.22, -0.10, 0],
        size: [0.25, 1.05, 0.32],
      },
      // Feet
      {
        id: 'foot-left',
        kind: 'foot-left',
        geometry: 'sphere',
        color: '#26314a',
        position: [-0.22, -0.72, 0.05],
        radius: 0.16,
      },
      {
        id: 'foot-right',
        kind: 'foot-right',
        geometry: 'sphere',
        color: '#26314a',
        position: [0.22, -0.72, 0.05],
        radius: 0.16,
      },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
  {
    id: 'avatar_user_default',
    name: 'You (placeholder)',
    description:
      'Stub user avatar. Same skeleton as the default mannequin with neutral colors. Replaced once the user steps through the avatar wardrobe.',
    ownerKind: 'user',
    ownerId: 'user_local',
    parts: [
      {
        id: 'head',
        kind: 'head',
        geometry: 'sphere',
        color: '#cdb4a4',
        position: [0, 1.55, 0],
        radius: 0.35,
      },
      {
        id: 'torso',
        kind: 'torso',
        geometry: 'box',
        color: '#5a5f6e',
        position: [0, 0.85, 0],
        size: [0.85, 1.1, 0.5],
      },
      {
        id: 'arm-left',
        kind: 'arm-left',
        geometry: 'box',
        color: '#5a5f6e',
        position: [-0.6, 0.85, 0],
        size: [0.22, 1.0, 0.32],
      },
      {
        id: 'arm-right',
        kind: 'arm-right',
        geometry: 'box',
        color: '#5a5f6e',
        position: [0.6, 0.85, 0],
        size: [0.22, 1.0, 0.32],
      },
      {
        id: 'hand-left',
        kind: 'hand-left',
        geometry: 'sphere',
        color: '#cdb4a4',
        position: [-0.6, 0.20, 0],
        radius: 0.13,
      },
      {
        id: 'hand-right',
        kind: 'hand-right',
        geometry: 'sphere',
        color: '#cdb4a4',
        position: [0.6, 0.20, 0],
        radius: 0.13,
      },
      {
        id: 'leg-left',
        kind: 'leg-left',
        geometry: 'box',
        color: '#33384a',
        position: [-0.22, -0.10, 0],
        size: [0.25, 1.05, 0.32],
      },
      {
        id: 'leg-right',
        kind: 'leg-right',
        geometry: 'box',
        color: '#33384a',
        position: [0.22, -0.10, 0],
        size: [0.25, 1.05, 0.32],
      },
      {
        id: 'foot-left',
        kind: 'foot-left',
        geometry: 'sphere',
        color: '#33384a',
        position: [-0.22, -0.72, 0.05],
        radius: 0.16,
      },
      {
        id: 'foot-right',
        kind: 'foot-right',
        geometry: 'sphere',
        color: '#33384a',
        position: [0.22, -0.72, 0.05],
        radius: 0.16,
      },
    ],
    createdAt: ts,
    updatedAt: ts,
  },
];

export const avatarSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Avatar',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'ownerKind', 'ownerId', 'parts', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      ownerKind: { type: 'string', enum: ['user', 'character', 'prop'] },
      ownerId: { type: 'string' },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'geometry', 'color', 'position'],
          properties: {
            id: { type: 'string' },
            kind: {
              type: 'string',
              enum: [
                'head',
                'crown',
                'halo',
                'torso',
                'arm-left',
                'arm-right',
                'hand-left',
                'hand-right',
                'waist',
                'leg-left',
                'leg-right',
                'foot-left',
                'foot-right',
                'prop',
                'accessory',
              ],
            },
            geometry: { type: 'string', enum: ['box', 'sphere', 'plane', 'torus', 'cylinder', 'cone'] },
            color: { type: 'string' },
            position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            scale: {
              oneOf: [
                { type: 'number' },
                { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
              ],
            },
            radius: { type: 'number' },
            tubeRadius: { type: 'number' },
            size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            visible: { type: 'boolean' },
          },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const avatarReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Owner — User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'ownerId (when ownerKind=user)',
    targetField: 'id',
    summary: 'When ownerKind=user, ownerId points at the user owning this avatar (their own visual).',
  },
  {
    kind: 'belongs-to',
    label: 'Owner — Character',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'ownerId (when ownerKind=character)',
    targetField: 'id',
    summary: 'When ownerKind=character, the avatar is bound to an AI character. Character.avatarId points back here.',
  },
];
