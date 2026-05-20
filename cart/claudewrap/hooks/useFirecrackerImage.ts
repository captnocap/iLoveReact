// useFirecrackerImage — current VM image + switch.
//
// The list is statically known from the imports below; scripts/claude-ss
// reads /tmp/reactjit-bridge/active-vm-recipe at boot to pick which
// .ext4 to attach. Switching writes that file + updates settings.

import { writeFile } from '../../../runtime/hooks/fs';
import { setSettings, useSettings } from '../state';
import workerMinimal from '../../../framework/firecracker/recipes/worker-minimal';
import workerDev from '../../../framework/firecracker/recipes/worker-dev';
import type { VmImage } from '../../../framework/firecracker/recipe';

const IMAGES: VmImage[] = [workerMinimal, workerDev];
const ACTIVE_CONFIG_PATH = '/tmp/reactjit-bridge/active-vm-recipe';

export function listImages(): VmImage[] { return IMAGES; }

export function useActiveImage(): VmImage {
  const { vmImage } = useSettings();
  return IMAGES.find(i => i.id === vmImage) ?? IMAGES[0];
}

export function setActiveImage(id: string): void {
  const found = IMAGES.find(i => i.id === id);
  if (!found) return;
  setSettings({ vmImage: id });
  try {
    writeFile(ACTIVE_CONFIG_PATH, id + '\n');
  } catch (e: any) {
    console.error('[claudewrap.vm] failed to persist active image:', e?.message || e);
  }
}
