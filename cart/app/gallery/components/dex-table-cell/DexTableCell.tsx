import { Box, Text } from '@reactjit/runtime/primitives';
import { DEX_COLORS } from '../dex-frame/DexFrame';

export type DexTableCellProps = {
  value?: string | number;
  tone?: 'default' | 'number' | 'ok' | 'warn' | 'flag' | 'edit';
  width?: number;
  flex?: number;
  selected?: boolean;
};

const TONE_COLOR = {
  default: DEX_COLORS.inkDim,
  number: DEX_COLORS.blue,
  ok: DEX_COLORS.ok,
  warn: DEX_COLORS.warn,
  flag: DEX_COLORS.flag,
  edit: DEX_COLORS.lilac,
};

export function DexTableCell({
  value = 'r_7f3a',
  tone = 'default',
  width = 92,
  flex,
  selected = false,
}: DexTableCellProps) {
  return (
    <Box
      style={{
        width: flex == null ? width : undefined,
        flex,
        height: 26,
        overflow: 'hidden',
        justifyContent: 'center',
        paddingLeft: 8,
        paddingRight: 8,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: DEX_COLORS.rule,
        backgroundColor: selected ? 'theme:bg1' : DEX_COLORS.bg,
      }}
    >
      <Text style={{ color: TONE_COLOR[tone], fontSize: 10 }} numberOfLines={1} noWrap>{String(value)}</Text>
    </Box>
  );
}
