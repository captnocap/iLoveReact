// shell/LabsRoute.tsx — the labs route: a collection of every lab, instantly
// loadable (V13). The first piece of shell/ — the tool's own surface, owning
// a route (STRUCTURE: index.tsx mounts shell; shell owns the routes; the rest
// of the shell extraction is the editors-capture lane).
//
// Shell imports NOTHING game-specific (the ruled arrow): the lab list arrives
// as plain data from the caller (labs/index.ts hands it across at the router).
// Per P6 the paired notes are ALWAYS surfaced beside the loaded lab — the
// notes are the lab's contract, and this panel is where humans read it.

import { useMemo } from 'react';
import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import { readFile } from '@reactjit/hooks/fs';
import { useRouteTwigState } from '../editors/twigs';

/** One loadable lab, as plain data — mirror of labs/index.ts's LabEntry. */
export type ShellLab = {
  name: string;
  Component: any;
  notesPath: string;
};

const RAIL_WIDTH = 220;
const NOTES_WIDTH = 320;

export function LabsRoute(props: { labs: ShellLab[]; onExit: () => void }) {
  const [openName, setOpenName] = useRouteTwigState<string | null>('/labs', 'openName', null);
  const open = props.labs.find((lab) => lab.name === openName) ?? null;

  // Re-read from disk on every open: the notes are living text — hot-edited
  // beside the lab — and disk is truth in this workspace.
  const notes = useMemo(
    () => (open ? readFile(open.notesPath) ?? `(no notes at ${open.notesPath})` : ''),
    [open],
  );

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#080d16' }}>
      {/* the collection — every lab, one click to load */}
      <Box style={{ width: RAIL_WIDTH, height: '100%', flexDirection: 'column', backgroundColor: '#0a1120' }}>
        <Pressable onPress={props.onExit}>
          <Box style={{ padding: 10 }}>
            <Text style={{ color: '#6f86ad', fontSize: 12 }}>← editor</Text>
          </Box>
        </Pressable>
        <Box style={{ paddingLeft: 10, paddingBottom: 6 }}>
          <Text style={{ color: '#9fb4d8', fontSize: 13 }}>{`labs (${props.labs.length})`}</Text>
        </Box>
        {/* VEHUI-0605: a literal height beside flexGrow pinned the viewport to
            100px (ScrollView needs an explicit height and ignores flexGrow);
            the grown Box owns the remaining rail space, the ScrollView fills it. */}
        <Box style={{ flexGrow: 1, minHeight: 0 }}>
          <ScrollView style={{ width: '100%', height: '100%' }}>
            {props.labs.length === 0 ? (
              <Box style={{ padding: 10 }}>
                <Text style={{ color: '#46587a', fontSize: 12 }}>{'no labs yet — rjit lab new <name>'}</Text>
              </Box>
            ) : null}
            {props.labs.map((lab) => (
              <Pressable key={lab.name} onPress={() => setOpenName(lab.name)}>
                <Box style={{ padding: 10, backgroundColor: lab.name === openName ? '#16233c' : 'transparent' }}>
                  <Text style={{ color: lab.name === openName ? '#d6e4ff' : '#8aa0c4', fontSize: 12 }}>{lab.name}</Text>
                </Box>
              </Pressable>
            ))}
          </ScrollView>
        </Box>
      </Box>

      {/* the loaded lab — the scene IS the lab; it owns this surface */}
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative' }}>
        {open ? (
          <open.Component />
        ) : (
          <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#46587a', fontSize: 13 }}>pick a lab to load it</Text>
          </Box>
        )}
      </Box>

      {/* the notes — the lab's P6 contract, always beside the loaded lab */}
      {open ? (
        <Box style={{ width: NOTES_WIDTH, height: '100%', flexDirection: 'column', backgroundColor: '#0a1120' }}>
          <Box style={{ padding: 10 }}>
            <Text style={{ color: '#9fb4d8', fontSize: 13 }}>{`${open.name}.notes.md`}</Text>
          </Box>
          {/* VEHUI-0605: same fix as the rail — fill, don't pin to 100px */}
          <Box style={{ flexGrow: 1, minHeight: 0 }}>
            <ScrollView style={{ width: '100%', height: '100%' }}>
              <Box style={{ padding: 10 }}>
                <Text style={{ color: '#8aa0c4', fontSize: 11 }}>{notes}</Text>
              </Box>
            </ScrollView>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
