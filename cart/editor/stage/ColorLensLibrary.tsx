import { C } from '../workspace.cls';
import { libraryRows, oklchName } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';

export default function ColorLensLibrary(props: {
  current: OklchColor;
  filter: 'match' | 'all';
  onSetFilter: (filter: 'match' | 'all') => void;
  onPickSwatch: (color: OklchColor) => void;
  onLoadSet: (colors: OklchColor[]) => void;
}) {
  const rows = libraryRows(props.current);
  const matchCount = rows.filter((row) => row.matched).length;
  const visible = props.filter === 'match' ? rows.filter((row) => row.matched) : rows;
  const label = props.filter === 'match' ? `${matchCount} sets use a color like ${oklchName(props.current)}` : 'All sets';

  return (
    <C.HW_LensBody>
      <C.HW_SpineLibraryHead>
        <C.HW_StatusText>{label}</C.HW_StatusText>
        <C.HW_SpineLibraryFilterTrack>
          {(['match', 'all'] as const).map((filter) => {
            const Btn = filter === props.filter ? C.HW_SpineLibraryFilterBtnOn : C.HW_SpineLibraryFilterBtn;
            const Label = filter === props.filter ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
            return (
              <Btn key={filter} onPress={() => props.onSetFilter(filter)}>
                <Label>{filter === 'match' ? 'Matches current' : 'Whole library'}</Label>
              </Btn>
            );
          })}
        </C.HW_SpineLibraryFilterTrack>
      </C.HW_SpineLibraryHead>
      <C.HW_SpineLibraryList>
        {visible.map((row) => (
          <C.HW_SpineLibraryRow key={row.name}>
            <C.HW_SpineLibraryRowHead>
              <C.HW_FormValue>{row.name}</C.HW_FormValue>
              {row.matched ? <C.HW_SpineLibraryTag>has yours</C.HW_SpineLibraryTag> : null}
              <C.HW_Spacer />
              <C.HW_SpineLibraryLoadPill onPress={() => props.onLoadSet(row.swatches.map((swatch) => swatch.color))}>
                <C.HW_PillText>load palette</C.HW_PillText>
              </C.HW_SpineLibraryLoadPill>
            </C.HW_SpineLibraryRowHead>
            <C.HW_SpineLibrarySwatchRow>
              {row.swatches.map((swatch, index) => (
                <C.HW_SpineLibrarySwatch
                  key={index}
                  onPress={() => props.onPickSwatch(swatch.color)}
                  style={{ backgroundColor: swatch.css, borderColor: swatch.isMatch ? '#ffffff' : undefined, borderWidth: swatch.isMatch ? 2 : 1 }}
                />
              ))}
            </C.HW_SpineLibrarySwatchRow>
          </C.HW_SpineLibraryRow>
        ))}
      </C.HW_SpineLibraryList>
      <C.HW_SpineLibraryFooter>
        <C.HW_KeyText>{rows.length} sets</C.HW_KeyText>
        <C.HW_Spacer />
      </C.HW_SpineLibraryFooter>
    </C.HW_LensBody>
  );
}
