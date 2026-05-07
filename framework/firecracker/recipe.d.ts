// VmImage — declarative recipe for a Firecracker worker rootfs.
//
// The recipe is the SPEC. The runner (scripts/firecracker-build.js) consumes it
// and produces a bootable rootfs image. Each recipe maps 1:1 onto a row in the
// gallery's VmImage table — same shape, same id space.
//
// Build pipeline driven by this spec:
//   1. mmdebstrap installs `base` + `apt[]` into a workdir (unprivileged)
//      with `npmGlobal[]` and `steps[]` running inside as customize hooks
//   2. mke2fs -d packages workdir → output.path as ext4 (unprivileged)
//      OR mksquashfs packages workdir → output.path as squashfs
//   3. Manifest written next to image: recorded apt versions, build time, hash

export type Suite = 'noble' | 'jammy' | 'bookworm' | 'trixie';
export type Arch = 'amd64' | 'aarch64';

export type BuildStep =
  | { run: string }                                              // chroot command
  | { writeFile: { path: string; content: string; mode?: number } }  // path inside guest
  | { copyFromHost: { src: string; dest: string } };             // src on host, dest in guest

export type OutputSpec =
  | { kind: 'ext4'; path: string; sizeMb: number }   // sizeMb required — ext4 has no auto-grow at build time
  | { kind: 'squashfs'; path: string };              // squashfs auto-sizes

export interface VmImage {
  id: string;             // 'worker-minimal', 'worker-dev', ...
  base: Suite;
  arch: Arch;
  apt: string[];
  npmGlobal?: string[];
  steps?: BuildStep[];
  output: OutputSpec;
}

// Default export of any recipe file must be a VmImage.
declare const _: VmImage;
export default _;
