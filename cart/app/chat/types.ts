// Persistent assistant chat — type sketches.
//
// v1 ships against fixtures, no persistence. Shapes are intentionally
// sparse: enough to drive the visual surface and the morph machinery,
// not enough to lock in a wire format. The follow-up commit that wires
// useCRUD will firm these up against `cart/component-gallery/data/`.

import type { Node } from '@reactjit/intent/parser';

export type ChatTurnMetadata = {
  backend?: string;
  model?: string;
  workerSessionId?: string;
  externalSessionId?: string;
  costUsd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

/** A turn is one prose row in the transcript. Surfaces (audit / fleet
 *  cards) are attached to assistant turns; user turns are prose only. */
export type AssistantTurn =
  | {
      id: string;
      author: 'asst';
      timestamp: string;          // 'HH:MM:SS' for v1; ISO when wired.
      body: string;
      surface?: ChatSurface;      // optional embedded card.
      lift?: boolean;             // shows the ▸ LIFT affordance in full.
      /** True while the model is still generating this turn. The render
       *  layer wraps the content area in a pixelate filter that
       *  oscillates while pending and tweens out on flip-to-false so
       *  the surface "materializes" from a scrambled placeholder. */
      pending?: boolean;
      metadata?: ChatTurnMetadata;
    }
  | {
      id: string;
      author: 'user';
      timestamp: string;
      body: string;
    }
  | {
      id: string;
      author: 'parallel';
      timestamp: string;
      userBody: string;
      candidates: ParallelCandidate[];
    };

export type ParallelCandidate = {
  id: string;
  modelId: string;
  modelLabel: string;
  body: string;
  surface?: ChatSurface;
  pending?: boolean;
  selected?: boolean;
  error?: string;
};

/** Embedded surface card. Discriminated union — extend by adding a
 *  kind here and a render branch in `AssistantSurface.tsx`. The audit
 *  and fleet shapes match the concept-art panels 1:1; later kinds
 *  arrive as the assistant emits them via IntentSurface. */
export type ChatSurface =
  | {
      kind: 'audit';
      title: string;
      tag?: string;               // e.g. 'READ-ONLY'
      command?: string;           // e.g. '$ swarm audit --readers 3'
      body?: string;              // prose under the command line.
      actions: ChatAction[];
    }
  | {
      kind: 'fleet';
      title: string;              // e.g. 'fleet · 4 active'
      members: FleetMember[];
      note?: string;              // e.g. 'frank-04 deviating ...'
      actions: ChatAction[];
    }
  | {
      // Model-emitted Intent tree — the chat-loom format. Provider runs
      // `parseIntent` on the finalized assistant reply; if any non-text
      // tag came back, the asst turn carries the AST here and renders
      // through <RenderIntent>. Btn/Submit replies bounce back into the
      // chat via askAssistant().
      kind: 'intent';
      nodes: Node[];
    };

export type FleetState = 'idle' | 'tool' | 'stuck' | 'rat';

export type FleetMember = {
  id: string;                     // 'frank-01', etc.
  state: FleetState;
};

export type ChatAction = {
  id: string;                     // 'run-audit', 'kill-frank-04', ...
  label: string;
  primary?: boolean;              // first action in the row gets emphasis.
};

/** Where the live chat surface renders. The side rail is the 95% case;
 *  'activity' is reserved for the dedicated /chat route. 'hidden' covers
 *  state 1 (no session committed yet — no rail at all). */
export type ChatShape = 'hidden' | 'side' | 'activity';

/** A persisted chat session — one conversation. Many of these accumulate
 *  per user; the rail's empty-chat state lists them so the user can
 *  resume any past conversation. Stored in the `assistant` bucket as
 *  entity `chat-session`. Turns are linked by `session_id`. */
export interface ChatSession {
  id: string;
  title: string;          // first user turn truncated, or '(untitled)' until set.
  created_at: string;     // ISO.
  updated_at: string;     // ISO. Bumped on each new turn for sort order.
  turn_count: number;     // denormalized for the rail history list.
  // The backend's own session id for this thread — for the claudewrap
  // headless bridge this is claude's self-assigned sid. Durable: it's
  // sent back as the resume key so the SAME claude process keeps serving
  // this thread across turns (and `--resume`s it after a restart).
  external_session_id?: string;
}
