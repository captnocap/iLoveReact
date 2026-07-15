// SDL3 modifier masks shared by keyboard and pointer bridges.
//
// Each mask covers both left and right variants. Keep this aligned with the
// SDL3 headers linked by framework/engine.zig if the runtime SDL major changes.
export const SDL_KMOD_SHIFT = 0x0003;
export const SDL_KMOD_CTRL = 0x00c0;
export const SDL_KMOD_ALT = 0x0300;
export const SDL_KMOD_GUI = 0x0c00;

export interface SdlModifierFlags {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Decode the live SDL_Keymod bitmask exposed by the native input bridge. */
export function decodeSdlModifiers(mod: number): SdlModifierFlags {
  return {
    ctrlKey: (mod & SDL_KMOD_CTRL) !== 0,
    shiftKey: (mod & SDL_KMOD_SHIFT) !== 0,
    altKey: (mod & SDL_KMOD_ALT) !== 0,
    metaKey: (mod & SDL_KMOD_GUI) !== 0,
  };
}
