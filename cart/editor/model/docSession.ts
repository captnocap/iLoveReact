// cart/editor/model/docSession.ts — WHO owns the host's live mesh, and which
// model identities this session has already handed out.
//
// The host process outlives the JS world, so the resident mesh survives a hot
// reload (req_2898). A twig records which editor document that mesh belongs to,
// and ModelView adopts the live session on mount when the twig names the
// document it is opening AND the host session key still matches.
//
// That claim is a LEASE, and a lease nobody releases is a landmine: a document
// closed without saving left the twig naming it forever, and the id allocator —
// which proves reuse from open tabs, the catalog, and disk — could see none of
// those for a never-saved doc and mint the same id again. The next New Mesh then
// opened a document that matched a dead lease and inherited the closed model's
// mesh, outliner rows, and reference images (req_3773 / req_3774). So the lease
// is released here when its document closes, and every identity handed out this
// session is remembered here even after every other trace of it is gone.
//
// Both live in hot state: they must survive a hot reload (the host still holds
// the mesh) and must NOT survive a cold restart (the host's mesh died with the
// process, and an unsaved document died with it).
import { getHotState, removeHotState, setHotState } from '@reactjit/runtime/hooks/useHotState';

const MODEL_DOC_SESSION_KEY = 'editor:meshdoc:v1';
const MINTED_MODEL_IDS_KEY = 'editor:minted-model-ids:v1';
export const MODEL_DOC_SESSION_PROTOCOL = 2 as const;

/** The document currently holding the host's resident mesh, the mesh key it was
 *  last seen at, and the mount policy that admitted it. All three must match. */
export type ModelDocSession = {
  docId: string;
  key: string;
  protocol: typeof MODEL_DOC_SESSION_PROTOCOL;
};

/** The twig's document id: package identity, not the tab's id — the viewer keys
 *  its per-document state (reference images, retopo guide) by the same string. */
export function modelDocSessionId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function readModelDocSession(): ModelDocSession | null {
  return getHotState<ModelDocSession | null>(MODEL_DOC_SESSION_KEY, null);
}

/** Claim the live mesh for `docId` at `key`. Re-claimed on every mesh re-key so
 *  the twig always names the CURRENT resident mesh. The protocol is explicit at
 *  the caller so a mount-policy change cannot silently reuse a legacy lease. */
export function claimModelDocSession(
  docId: string,
  key: string,
  protocol: typeof MODEL_DOC_SESSION_PROTOCOL,
): void {
  setHotState<ModelDocSession>(MODEL_DOC_SESSION_KEY, { docId, key, protocol });
}

/** Drop the claim when `docId` closes (or unconditionally when it is omitted —
 *  the Discard rollback drops whatever claim the working copy held). Closing a
 *  BACKGROUND document must never release the active document's claim, so a
 *  targeted release only fires when the twig actually names that document.
 *  Returns whether a claim was dropped. */
export function releaseModelDocSession(docId?: string): boolean {
  if (docId !== undefined && readModelDocSession()?.docId !== docId) return false;
  removeHotState(MODEL_DOC_SESSION_KEY);
  return true;
}

/** Every model identity this session has minted, including ones whose document
 *  was closed unsaved and now exists nowhere else. */
export function mintedModelIds(): readonly string[] {
  return getHotState<string[]>(MINTED_MODEL_IDS_KEY, []);
}

/** Retire an identity permanently for this session. Call at the moment the id is
 *  handed to a document — not at save — because the unsaved close is exactly the
 *  case no other source can prove. */
export function rememberMintedModelId(id: string): void {
  const seen = mintedModelIds();
  if (seen.includes(id)) return;
  setHotState<string[]>(MINTED_MODEL_IDS_KEY, [...seen, id]);
}
