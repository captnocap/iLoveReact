import { Pressable, Text } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import BrowserIcon, { BrowserIconName } from './BrowserIcon';

type Tone = 'default' | 'accent' | 'warm' | 'ghost';

function palette(tone: Tone, active: boolean) {
  if (tone === 'accent') {
    return {
      bg: active ? '#5d8fe4' : COLORS.accent,
      border: active ? '#5d8fe4' : COLORS.accent,
      text: '#0f1115',
    };
  }
  if (tone === 'warm') {
    return {
      bg: active ? '#bf923d' : COLORS.accentWarm,
      border: active ? '#bf923d' : COLORS.accentWarm,
      text: '#18120a',
    };
  }
  if (tone === 'ghost') {
    return {
      bg: active ? COLORS.chromeRaised : COLORS.chrome,
      border: COLORS.border,
      text: COLORS.text,
    };
  }
  return {
    bg: active ? COLORS.chromeRaised : COLORS.chromeInset,
    border: active ? COLORS.borderStrong : COLORS.border,
    text: COLORS.text,
  };
}

export default function ShellButton({
  label,
  icon,
  onPress,
  disabled = false,
  active = false,
  tone = 'default',
  width,
  minWidth,
  height = 34,
  fontSize = 11,
  iconSize,
  iconStrokeWidth,
  paddingX = 12,
}: {
  label?: string;
  icon?: BrowserIconName;
  onPress?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: Tone;
  width?: number;
  minWidth?: number;
  height?: number;
  fontSize?: number;
  iconSize?: number;
  iconStrokeWidth?: number;
  paddingX?: number;
}) {
  const colors = palette(tone, active);
  const action = disabled ? undefined : onPress;

  return (
    <Pressable
      onPress={action}
      onClick={action}
      style={{
        width,
        minWidth: width ?? minWidth,
        height,
        paddingLeft: paddingX,
        paddingRight: paddingX,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: disabled ? COLORS.chrome : colors.bg,
        borderWidth: 1,
        borderColor: disabled ? COLORS.border : colors.border,
      }}
    >
      {icon ? (
        <BrowserIcon
          name={icon}
          size={iconSize ?? Math.max(12, height - 10)}
          strokeWidth={iconStrokeWidth ?? 1.8}
          color={disabled ? COLORS.textFaint : colors.text}
          onPress={action}
        />
      ) : (
        <Text
          onClick={action}
          onPress={action}
          style={{
            fontSize,
            fontWeight: 'bold',
            color: disabled ? COLORS.textFaint : colors.text,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
