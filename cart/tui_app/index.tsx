// cart/tui_app — TUI surface over the same chat datashapes cart/app uses.
//
// Entry point: mounts Router → AssistantChatProvider → Shell. The provider
// is the invisible coordinator that publishes askAssistant() into the
// module-level chat store; once it's mounted, anything in the tree (the
// chat route's input, the sessions route's reload action, future @-token
// triggers, etc.) can fire turns through the same code path the GUI uses.
//
// Ship:  ./scripts/ship-tui cart/tui_app/index.tsx
// Run:   ./zig-out/bin/tui_app
//
// The TUI shape is intentionally NOT a port of cart/app's GOLDEN morph
// (bottom-bar + side-rail + activity area). Terminals don't have the
// horizontal real estate for that, and the user said early: "the tui
// doesnt need to resemble the shape of the gui it just needs to connect
// to all of the datashapes for starters and then from there we can make
// a chat interface and some routes but they clearly wont be the same."
// So this cart owns its own layout — top nav bar, route body, status
// footer — while sharing every byte of the underlying chat/db model.

import * as React from 'react';
import { Box } from '@reactjit/primitives';
import { Router } from '../app/gallery/local-router';
import { AssistantChatProvider } from '../app/chat/AssistantChatProvider';
import { Shell } from './Shell';
import { HeadlessBridge } from './bridge/HeadlessBridge';

export default function TuiApp() {
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Router initialPath="/chat" hotKey="tui_app">
        <AssistantChatProvider surfaceMode="text" />
        {/* Invisible. Binds the OpenAI-compatible HTTP bridge and spawns
            interactive claude into a headless PTY — the claude -p
            billing workaround, running with no visible terminal. Seeds a
            selectable "Claude (headless bridge)" provider; not bound as
            default until the user picks it in /models. */}
        <HeadlessBridge />
        <Shell />
      </Router>
    </Box>
  );
}
