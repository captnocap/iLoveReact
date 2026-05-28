export type HmscControlAction =
  | 'cameraLookOrbit'
  | 'aimOverShoulder'
  | 'primaryAimedAction'
  | 'primaryLightAction'
  | 'interact'
  | 'reload'
  | 'quickMenu'
  | 'run'
  | 'jumpMantle'
  | 'crouch';

export type HmscInputBinding = {
  action: HmscControlAction;
  inputs: string[];
  label: string;
  playerIntent: string;
  availability: 'implemented' | 'reserved';
};

export const HMSC_INPUT_BINDINGS: HmscInputBinding[] = [
  {
    action: 'cameraLookOrbit',
    inputs: ['Mouse move'],
    label: 'Camera look/orbit',
    playerIntent: 'Orbit the third-person camera around the player.',
    availability: 'implemented',
  },
  {
    action: 'aimOverShoulder',
    inputs: ['Right mouse hold'],
    label: 'Aim over shoulder',
    playerIntent: 'Apply the shoulder camera shift and show the aim crosshair.',
    availability: 'implemented',
  },
  {
    action: 'primaryAimedAction',
    inputs: ['Left mouse while aiming'],
    label: 'Fire / attack / throw',
    playerIntent: 'Use the equipped item against the aimed target.',
    availability: 'reserved',
  },
  {
    action: 'primaryLightAction',
    inputs: ['Left mouse while not aiming'],
    label: 'Light action',
    playerIntent: 'Punch, select, or do nothing depending on the active context.',
    availability: 'reserved',
  },
  {
    action: 'interact',
    inputs: ['E', 'F'],
    label: 'Interact',
    playerIntent: 'Use the closest valid world interaction.',
    availability: 'reserved',
  },
  {
    action: 'reload',
    inputs: ['R'],
    label: 'Reload',
    playerIntent: 'Reload the equipped item when that item supports ammo.',
    availability: 'reserved',
  },
  {
    action: 'quickMenu',
    inputs: ['Q', 'Tab'],
    label: 'Item wheel / phone / quick menu',
    playerIntent: 'Open the quick inventory or phone surface.',
    availability: 'reserved',
  },
  {
    action: 'run',
    inputs: ['Shift'],
    label: 'Run',
    playerIntent: 'Move at the run speed while the movement vector is active.',
    availability: 'implemented',
  },
  {
    action: 'jumpMantle',
    inputs: ['Space'],
    label: 'Jump / mantle',
    playerIntent: 'Jump when grounded, or mantle when a valid ledge is detected.',
    availability: 'implemented',
  },
  {
    action: 'crouch',
    inputs: ['Ctrl', 'C'],
    label: 'Crouch',
    playerIntent: 'Lower stance and reduce movement/noise profile.',
    availability: 'reserved',
  },
];

export function inputBindingsForConsole(): string[] {
  return HMSC_INPUT_BINDINGS.map((binding) => {
    const inputs = binding.inputs.join(' / ');
    return `${inputs.padEnd(24)} ${binding.label} (${binding.availability})`;
  });
}
