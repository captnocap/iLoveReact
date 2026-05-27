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
import { Col, ScrollView } from '@reactjit/runtime/primitives';
import { useRoute } from '../app/gallery/local-router';
import { NavBar } from './components/NavBar';
import { Footer } from './components/Footer';
import { ChatRoute } from './routes/chat';
import { SessionsRoute } from './routes/sessions';
import { StatusRoute } from './routes/status';
import { UserRoute } from './routes/user';
import { ProvidersRoute } from './routes/providers';
import { ModelsRoute } from './routes/models';
import { MetadataRoute } from './routes/metadata';

export function Shell() {
  const { path } = useRoute();
  const isChat = !path.startsWith('/sessions')
    && !path.startsWith('/user')
    && !path.startsWith('/providers')
    && !path.startsWith('/models')
    && !path.startsWith('/metadata')
    && !path.startsWith('/status');

  let body: React.ReactNode;
  if (path.startsWith('/sessions')) body = <SessionsRoute />;
  else if (path.startsWith('/user')) body = <UserRoute />;
  else if (path.startsWith('/providers')) body = <ProvidersRoute />;
  else if (path.startsWith('/models')) body = <ModelsRoute />;
  else if (path.startsWith('/metadata')) body = <MetadataRoute />;
  else if (path.startsWith('/status')) body = <StatusRoute />;
  else body = <ChatRoute />;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0a0e17' }}>
      <NavBar activePath={path} />
      <Col style={{ flexGrow: 1, flexShrink: 1, width: '100%', minHeight: 0 }}>
        {isChat ? (
          body
        ) : (
          <ScrollView showScrollbar style={{ flexGrow: 1, flexShrink: 1, width: '100%' }}>
            {body}
          </ScrollView>
        )}
      </Col>
      <Footer />
    </Col>
  );
}
