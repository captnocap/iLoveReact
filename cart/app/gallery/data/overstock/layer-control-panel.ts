export type LayerKind = 'pixel' | 'group' | 'adjustment' | 'type' | 'mask' | 'smart';

export type LayerBlendMode = 'Normal' | 'Multiply' | 'Screen' | 'Overlay';

export type LayerControlLayer = {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  clipped?: boolean;
  opacity: number;
  fill: number;
  blendMode: LayerBlendMode;
  effects: number;
  mask: boolean;
  maskLow: number;
  maskHigh: number;
  color: string;
  thumbnail: string;
  childCount?: number;
  note: string;
};

export type LayerControlPanelData = {
  documentName: string;
  canvas: string;
  activeChannel: string;
  filters: string[];
  blendModes: LayerBlendMode[];
  layers: LayerControlLayer[];
};

export const layerBlendModes: LayerBlendMode[] = ['Normal', 'Multiply', 'Screen', 'Overlay'];

export const layerControlPanelMockData: LayerControlPanelData = {
  documentName: 'city-poster.psd',
  canvas: '24 x 36 / 300dpi',
  activeChannel: 'RGB',
  filters: ['ALL', 'PIX', 'TYPE', 'FX'],
  blendModes: layerBlendModes,
  layers: [
    {
      id: 'fx-grade',
      name: 'grade / warm contrast',
      kind: 'adjustment',
      visible: true,
      locked: false,
      opacity: 72,
      fill: 100,
      blendMode: 'Overlay',
      effects: 1,
      mask: true,
      maskLow: 18,
      maskHigh: 84,
      color: 'theme:warn',
      thumbnail: 'CRV',
      note: 'Curves stack clipped to poster group.',
    },
    {
      id: 'title-type',
      name: 'headline - union square',
      kind: 'type',
      visible: true,
      locked: false,
      opacity: 94,
      fill: 88,
      blendMode: 'Normal',
      effects: 2,
      mask: false,
      maskLow: 0,
      maskHigh: 100,
      color: 'theme:ink',
      thumbnail: 'TXT',
      note: 'Editable type layer with stroke and drop shadow.',
    },
    {
      id: 'photo-group',
      name: 'photo plates',
      kind: 'group',
      visible: true,
      locked: false,
      opacity: 100,
      fill: 100,
      blendMode: 'Normal',
      effects: 0,
      mask: true,
      maskLow: 24,
      maskHigh: 78,
      color: 'theme:blue',
      thumbnail: 'GRP',
      childCount: 4,
      note: 'Four linked image plates with a shared edge mask.',
    },
    {
      id: 'fog-overlay',
      name: 'soft fog overlay',
      kind: 'pixel',
      visible: true,
      locked: false,
      clipped: true,
      opacity: 46,
      fill: 52,
      blendMode: 'Screen',
      effects: 0,
      mask: true,
      maskLow: 12,
      maskHigh: 63,
      color: 'theme:lilac',
      thumbnail: 'IMG',
      note: 'Screen blend plate clipped to the photo stack.',
    },
    {
      id: 'edge-mask',
      name: 'paper edge mask',
      kind: 'mask',
      visible: true,
      locked: true,
      opacity: 100,
      fill: 100,
      blendMode: 'Normal',
      effects: 0,
      mask: true,
      maskLow: 8,
      maskHigh: 92,
      color: 'theme:ok',
      thumbnail: 'MSK',
      note: 'Protected alpha mask for deckle edge texture.',
    },
    {
      id: 'texture-smart',
      name: 'smart grain overlay',
      kind: 'smart',
      visible: false,
      locked: false,
      opacity: 38,
      fill: 74,
      blendMode: 'Multiply',
      effects: 1,
      mask: false,
      maskLow: 0,
      maskHigh: 100,
      color: 'theme:accent',
      thumbnail: 'OBJ',
      note: 'Linked object hidden while print proof is open.',
    },
  ],
};
