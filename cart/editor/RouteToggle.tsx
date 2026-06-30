// RouteToggle — the platform-level Editor/Play route switch. Floats top-right over
// the active route. (The deeper Compile→Play flow lands later; this is the explicit
// nav affordance so the two routes are reachable now.)
import { useNavigate, useRoute } from '../../runtime/router';
import { C } from './editor.cls';

export default function RouteToggle() {
  const nav = useNavigate();
  const { path } = useRoute();
  const onPlay = path === '/play';
  const EditorBtn = onPlay ? C.ED_Tab : C.ED_TabOn;
  const EditorTxt = onPlay ? C.ED_TabText : C.ED_TabTextOn;
  const PlayBtn = onPlay ? C.ED_TabOn : C.ED_Tab;
  const PlayTxt = onPlay ? C.ED_TabTextOn : C.ED_TabText;
  return (
    <C.ED_RouteToggle>
      <EditorBtn onPress={() => nav.push('/editor')}><EditorTxt>Editor</EditorTxt></EditorBtn>
      <PlayBtn onPress={() => nav.push('/play')}><PlayTxt>Play</PlayTxt></PlayBtn>
    </C.ED_RouteToggle>
  );
}
