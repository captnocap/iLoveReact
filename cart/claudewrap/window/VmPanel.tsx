// VmPanel — pick the firecracker image scripts/claude-ss boots.
//
// Reads from framework/firecracker/recipes/* (statically imported via
// useFirecrackerImage). Switching writes /tmp/reactjit-bridge/active-vm-recipe;
// the next claude-ss boot picks it up (existing running VM is unaffected).

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { listImages, setActiveImage } from '../hooks/useFirecrackerImage';
import { useSettings } from '../state';

export function VmPanel() {
  const { vmImage } = useSettings();
  const images = listImages();

  return (
    <Col style={{ gap: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>vm images</Text>
      <Text style={{ color: palette.dim }}>
        scripts/claude-ss reads /tmp/reactjit-bridge/active-vm-recipe at boot
      </Text>
      <Text style={{ color: palette.dim }}>
        changes take effect on the next claude-ss spawn (current vterm unaffected)
      </Text>
      <Text> </Text>
      <ScrollView style={{ flexGrow: 1 }}>
        {images.map((img) => {
          const isActive = img.id === vmImage;
          const sizeMb = img.output.kind === 'ext4' ? img.output.sizeMb : null;
          return (
            <Col key={img.id} style={{ gap: 0, paddingBottom: 1 }}>
              <Row style={{ gap: 1 }}>
                <Pressable onPress={() => setActiveImage(img.id)}>
                  <Text style={{
                    color: isActive ? palette.good : palette.dim,
                    fontWeight: 'bold',
                  }}>
                    {isActive ? '[active]' : '[switch]'}
                  </Text>
                </Pressable>
                <Text style={{ color: palette.ink, fontWeight: 'bold' }}>{img.id}</Text>
                <Text style={{ color: palette.dim }}>{img.base}/{img.arch}</Text>
                <Text style={{ color: palette.dim }}>·</Text>
                <Text style={{ color: palette.dim }}>{img.output.kind}</Text>
                {sizeMb !== null && (
                  <Text style={{ color: palette.dim }}>{sizeMb}MB</Text>
                )}
              </Row>
              <Box style={{ paddingLeft: 9 }}>
                <Text style={{ color: palette.dim }}>{img.output.path}</Text>
                <Text style={{ color: palette.dim }}>
                  apt: {img.apt.slice(0, 6).join(', ')}{img.apt.length > 6 ? '…' : ''}
                </Text>
                {img.npmGlobal && img.npmGlobal.length > 0 && (
                  <Text style={{ color: palette.dim }}>
                    npm: {img.npmGlobal.join(', ')}
                  </Text>
                )}
              </Box>
            </Col>
          );
        })}
      </ScrollView>
    </Col>
  );
}
