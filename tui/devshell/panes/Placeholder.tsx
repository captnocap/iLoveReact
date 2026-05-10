// Stub for unwired panes. Surfaces a name + the next concrete TODO so
// the shell stays self-documenting as panes are filled in.

import * as React from 'react';
import { Col, Text } from '../../../runtime/primitives';

export function Placeholder({ name, next }: { name: string; next: string }) {
  return (
    <Col style={{ gap: 1 }}>
      <Text style={{ color: 'theme:accent', fontWeight: 'bold' }}>{name}</Text>
      <Text style={{ color: 'theme:inkDim' }}>not yet wired</Text>
      <Text style={{ color: 'theme:ink' }}>next step: {next}</Text>
    </Col>
  );
}
