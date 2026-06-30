// buildjournal/index.ts — the build-journal + bug-thread surface.
//
// The request ledger turned into a visible, self-incrementing build-number
// stream plus durable bug threads (stable ids, human-editable names) that
// reattach across sessions. Data model + pure logic; the clickable dialog is a
// later UI task that consumes this. See DESIGN_INTAKE → "Bottom Dock And Build
// Journal" and EDITOR_FOUNDATION_CONTRACTS seam F.

export type {
  BuildNote, BugThread, LogCapture, RequestEntry, ThreadLink,
} from './types';
export {
  BUILD_BASE, deriveBuildNumber, requestNumber, buildNumberToRequest,
} from './buildNumber';
export { BuildJournal, type NewThread, type JournalThreadState } from './journal';
