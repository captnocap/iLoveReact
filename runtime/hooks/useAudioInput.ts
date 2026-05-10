import { useCallback, useEffect, useState } from 'react';
import { useVoiceInput, type VoiceInputOptions, type VoiceInputResult } from './useVoiceInput';

declare const globalThis: any;

export interface AudioInputDevice {
  id: number;
  name: string;
}

export interface AudioInputOptions extends VoiceInputOptions {
  autoStart?: boolean;
}

export interface AudioInputHandle extends VoiceInputResult {
  devices: AudioInputDevice[];
  refreshDevices: () => AudioInputDevice[];
}

function readDevices(): AudioInputDevice[] {
  const fn = globalThis.__audio_input_devices_json ?? globalThis.__voice_recording_devices_json;
  if (typeof fn !== 'function') return [];
  try {
    const parsed = JSON.parse(String(fn() ?? '[]'));
    return Array.isArray(parsed) ? parsed.map((d) => ({
      id: Number(d.id || 0),
      name: String(d.name || ''),
    })) : [];
  } catch {
    return [];
  }
}

export function useAudioInput(options: AudioInputOptions = {}): AudioInputHandle {
  const voice = useVoiceInput(options);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);

  const refreshDevices = useCallback(() => {
    const next = readDevices();
    setDevices(next);
    return next;
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!options.autoStart) return;
    voice.start();
    return () => voice.stop();
  }, [options.autoStart]);

  return {
    ...voice,
    devices,
    refreshDevices,
  };
}
