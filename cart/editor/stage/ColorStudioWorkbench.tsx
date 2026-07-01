import { C } from '../workspace.cls';
import { fitsWellNow, type ColorLens } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';
import ColorSpineHeader from './ColorSpineHeader';
import ColorSpineTray from './ColorSpineTray';
import ColorLensTabs from './ColorLensTabs';
import ColorLensField from './ColorLensField';
import ColorLensMix from './ColorLensMix';
import ColorLensScene from './ColorLensScene';
import ColorLensRamp from './ColorLensRamp';
import ColorLensLibrary from './ColorLensLibrary';

export default function ColorStudioWorkbench(props: {
  current: OklchColor;
  palette: OklchColor[];
  lens: ColorLens;
  libraryFilter: 'match' | 'all';
  rampSteps: number;
  scenePick: string | null;
  onSetCurrent: (color: OklchColor) => void;
  onAddToTray: () => void;
  onPickTray: (color: OklchColor) => void;
  onSetLens: (lens: ColorLens) => void;
  onSetLibraryFilter: (filter: 'match' | 'all') => void;
  onSetRampSteps: (steps: number) => void;
  onScenePick: (color: OklchColor, css: string) => void;
  onLoadLibrarySet: (colors: OklchColor[]) => void;
}) {
  const fits = fitsWellNow(props.current);

  return (
    <C.HW_ColorPreviewPanel>
      <C.HW_ColorStudioBody style={{ flexDirection: 'column', padding: 14, gap: 14 }}>
        <ColorSpineHeader current={props.current} onAddToTray={props.onAddToTray} />
        <C.HW_KeyText>FITS WELL</C.HW_KeyText>
        <C.HW_SpineFitsRow>
          {fits.map((fit, index) => (
            <C.HW_SpineFitSwatch key={index} onPress={() => props.onSetCurrent(fit.color)} style={{ backgroundColor: fit.css }} />
          ))}
        </C.HW_SpineFitsRow>
        <ColorLensTabs lens={props.lens} onSelect={props.onSetLens} />
        {props.lens === 'field' ? <ColorLensField current={props.current} onPick={props.onSetCurrent} /> : null}
        {props.lens === 'mix' ? <ColorLensMix onPick={props.onSetCurrent} /> : null}
        {props.lens === 'scene' ? <ColorLensScene scenePick={props.scenePick} onPick={props.onScenePick} /> : null}
        {props.lens === 'ramp' ? (
          <ColorLensRamp current={props.current} steps={props.rampSteps} onPick={props.onSetCurrent} onSetSteps={props.onSetRampSteps} />
        ) : null}
        {props.lens === 'library' ? (
          <ColorLensLibrary
            current={props.current}
            filter={props.libraryFilter}
            onSetFilter={props.onSetLibraryFilter}
            onPickSwatch={props.onSetCurrent}
            onLoadSet={props.onLoadLibrarySet}
          />
        ) : null}
        <ColorSpineTray palette={props.palette} onPick={props.onPickTray} />
      </C.HW_ColorStudioBody>
    </C.HW_ColorPreviewPanel>
  );
}
