// Shell — TUI chrome. Top nav bar, route body, status footer.
//
// The body slot is a thin route-switcher: read the current path from
// the router, render the matching route component. We don't use
// <Route> path-matching because the TUI's three routes are all the
// same shape (full-body content, no layout differences) and an
// explicit switch reads more clearly than a stack of conditional
// <Route> children.
//
// Why a Shell file instead of inlining: the "extend" rule. Adding a
// new route is one line in the switch + one new file under routes/.
// Adding a status indicator is one line in Footer. The chrome and
// the routes never have to know about each other.

import * as React from 'react';
import { Col } from '@reactjit/runtime/primitives';
import { useRoute } from '../app/gallery/local-router';
import { NavBar } from './components/NavBar';
import { Footer } from './components/Footer';
import { ChatRoute } from './routes/chat';
import { SessionsRoute } from './routes/sessions';
import { StatusRoute } from './routes/status';

export function Shell() {
  const { path } = useRoute();

  let body: React.ReactNode;
  if (path.startsWith('/sessions')) body = <SessionsRoute />;
  else if (path.startsWith('/status')) body = <StatusRoute />;
  else body = <ChatRoute />;

  return (
    <Col style={{ width: '100%', height: '100%' }}>
      <NavBar activePath={path} />
      <Col style={{ flexGrow: 1, width: '100%' }}>
        {body}
      </Col>
      <Footer />
    </Col>
  );
}
