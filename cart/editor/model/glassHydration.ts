export type SavedGlassRestoreInput = {
  resumedHostSession: boolean;
  alreadyRestored: boolean;
  glassFirstVertex: number | null | undefined;
};

/** Decide whether the saved RJMD glass boundary belongs on the resident mesh. */
export function shouldRestoreSavedGlass(input: SavedGlassRestoreInput): boolean {
  return !input.resumedHostSession
    && !input.alreadyRestored
    && typeof input.glassFirstVertex === 'number'
    && input.glassFirstVertex >= 0;
}
