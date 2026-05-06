// Modal input claim. When a pane goes into a typing-edit mode (e.g.
// the LogsPane filter editor), it sets `claimed=true` so the Shell-
// level subscribeKey handler bails on its global shortcuts (l/y/?
// etc.). The pane's own subscribeKey then has exclusive access.
//
// One bool. No subscription model — readers just check on each
// keystroke. Works because subscribeKey fires every handler each
// event so a single check per handler is enough.

let claimed = false;

export function isInputClaimed(): boolean { return claimed; }
export function claimInput(): void { claimed = true; }
export function releaseInput(): void { claimed = false; }
