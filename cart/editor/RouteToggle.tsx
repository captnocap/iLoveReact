// RouteToggle — the platform-level Editor/Play route switch. Lives INLINE in the
// top chrome row (see Chrome.tsx), a real member of the bar sharing its centerline
// — not a floating overlay. Because the chrome (AppFrame shell) is mounted on both
// routes, this stays reachable on /play too. (The deeper Compile→Play flow lands
// later; this is the explicit nav affordance so the two routes are reachable now.)
import { useNavigate, useRoute } from '../../runtime/router';
import { C } from './editor.cls';
import { worldBibleController } from './worldBible/controller';

export default function RouteToggle() {
  const nav = useNavigate();
  const { path } = useRoute();
  const onPlay = path === '/play';
  const EditorBtn = onPlay ? C.ED_Tab : C.ED_TabOn;
  const EditorTxt = onPlay ? C.ED_TabText : C.ED_TabTextOn;
  const PlayBtn = onPlay ? C.ED_TabOn : C.ED_Tab;
  const PlayTxt = onPlay ? C.ED_TabTextOn : C.ED_TabText;
  const enterPlay = () => {
    if (worldBibleController.settleBeforePlay()) nav.push('/play');
  };
  return (
    <C.ED_RouteToggle>
      <EditorBtn onPress={() => nav.push('/editor')}><EditorTxt>Editor</EditorTxt></EditorBtn>
      <PlayBtn onPress={enterPlay}><PlayTxt>Play</PlayTxt></PlayBtn>
    </C.ED_RouteToggle>
  );
}
