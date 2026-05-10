import { useEffect, useRef } from 'react';
import { Row } from '@reactjit/runtime/primitives';
import {
  DEFAULT_BRAILLE_PROJECTION_THEME,
  GAIN_PRESETS,
  PROJECTION_SIZES,
  SPEED_PRESETS,
  type BrailleProjectionTheme,
  type ChannelId,
  type InstrumentSimulation,
  type PaletteId,
  type ProjectionSize,
  createInstrumentSimulation,
  resetInstrumentChannel,
  resolveBrailleProjectionTheme,
  renderSurface,
} from './matrixDisplayModel';
import { BrailleProjectionSurface } from './BrailleProjectionSurface';

export type BrailleEffectInstrumentProps = {
  size?: ProjectionSize;
  channelId?: ChannelId;
  paletteId?: PaletteId;
  speed?: number;
  gain?: number;
  theme?: Partial<BrailleProjectionTheme>;
};

export type BrailleProjectionStripProps = {
  sizes?: readonly ProjectionSize[];
  channelId?: ChannelId;
  paletteId?: PaletteId;
  speed?: number;
  gain?: number;
  theme?: Partial<BrailleProjectionTheme>;
};

function useInstrumentSimulation(): InstrumentSimulation {
  const simulationRef = useRef<InstrumentSimulation | null>(null);
  if (!simulationRef.current) simulationRef.current = createInstrumentSimulation();
  return simulationRef.current;
}

function resolvedSpeed(value?: number): number {
  return value ?? SPEED_PRESETS[2];
}

function resolvedGain(value?: number): number {
  return value ?? GAIN_PRESETS[2];
}

export function BrailleProjectionSquare(props: BrailleEffectInstrumentProps) {
  const simulation = useInstrumentSimulation();
  const channelId = props.channelId ?? 'plasma';
  const paletteId = props.paletteId ?? 'amber';
  const speed = resolvedSpeed(props.speed);
  const gain = resolvedGain(props.gain);
  const theme = props.theme ? resolveBrailleProjectionTheme(props.theme) : DEFAULT_BRAILLE_PROJECTION_THEME;

  useEffect(() => {
    resetInstrumentChannel(simulation, channelId);
  }, [simulation, channelId]);

  return (
    <BrailleProjectionSurface
      key={`braille-square:${props.size ?? 128}:${channelId}:${paletteId}:${speed}:${gain}`}
      size={props.size ?? 128}
      simulation={simulation}
      channelId={channelId}
      paletteId={paletteId}
      speed={speed}
      gain={gain}
      theme={theme}
    />
  );
}


export { renderSurface };
