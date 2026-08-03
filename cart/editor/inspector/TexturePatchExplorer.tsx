import { useMemo, useState } from 'react';
import { Box, Col, Image, Pressable, Row, ScrollView, Text, TextInput } from '../../../runtime/primitives';
import { pickFiles } from '../../../runtime/hooks/pickFile';
import { readFileBase64 } from '../../../runtime/hooks/fs';
import { image as imageOps } from '../../../runtime/image';
import { Icon } from '../../../runtime/icons/Icon';
import {
  loadTexturePackages,
  saveExactImage,
  texturePatchPackages,
  textureSlug,
  textureSpec,
  type TexturePatchPackage,
} from '../data/texturePackage';
import { registerImportedSpecs } from '../textures/shaders';
import { accentFor } from '../workspace.cls';

const PAGE_SIZE = 20;
const IMAGE_FILTERS = [{ name: 'Images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp'] }];

function importedTextureSpecs() {
  return loadTexturePackages()
    .map((pkg) => textureSpec(pkg, (base64) => imageOps(base64).raw()))
    .filter((spec): spec is NonNullable<typeof spec> => spec !== null);
}

function sourceLabel(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[a-z0-9]+$/i, '') || base;
}

export default function TexturePatchExplorer(props: {
  patches: readonly TexturePatchPackage[];
  onUse: (patch: TexturePatchPackage) => void;
  onImported: (message: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(props.patches[0]?.id ?? '');
  const [importing, setImporting] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return props.patches
      .filter((patch) => !needle || `${patch.name} ${patch.imagePath}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [props.patches, query]);
  const maxPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
  const activePage = Math.min(page, maxPage);
  const visible = matches.slice(activePage * PAGE_SIZE, activePage * PAGE_SIZE + PAGE_SIZE);
  const selected = props.patches.find((patch) => patch.id === selectedId)
    ?? visible[0]
    ?? matches[0]
    ?? null;

  const importImages = async () => {
    if (importing) return;
    setImporting(true);
    const paths = await pickFiles({ title: 'Import reusable textures', filters: IMAGE_FILTERS });
    if (paths.length === 0) {
      setImporting(false);
      return;
    }
    let imported = 0;
    let failed = 0;
    const batchSlugs = new Set<string>();
    for (const path of paths) {
      const base64 = readFileBase64(path);
      const meta = base64 ? imageOps(base64).metadata() : null;
      if (!meta) {
        failed += 1;
        continue;
      }
      const baseName = sourceLabel(path);
      let name = baseName;
      let suffix = 2;
      while (batchSlugs.has(textureSlug(name))) name = `${baseName} ${suffix++}`;
      batchSlugs.add(textureSlug(name));
      if (saveExactImage(name, path, meta.width, meta.height)) imported += 1;
      else failed += 1;
    }
    registerImportedSpecs(importedTextureSpecs());
    setImporting(false);
    props.onImported(
      imported > 0
        ? `imported ${imported} reusable texture${imported === 1 ? '' : 's'}${failed > 0 ? ` · ${failed} skipped` : ''}`
        : `no textures imported · ${failed} file${failed === 1 ? '' : 's'} could not be decoded or saved`,
    );
  };

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 80, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable onPress={props.onClose} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,7,12,0.72)' }} />
      <Col style={{ width: 680, height: 470, padding: 14, gap: 10, backgroundColor: accentFor('surface'), borderWidth: 1, borderColor: accentFor('border'), borderRadius: 10 }}>
        <Row style={{ height: 28, alignItems: 'center', gap: 7 }}>
          <Icon name="Images" size={14} color={accentFor('primary')} />
          <Text style={{ color: accentFor('text'), fontSize: 13, fontWeight: '900' }}>Texture Library</Text>
          <Text style={{ color: accentFor('textFaint'), fontSize: 9, fontFamily: 'ui-monospace' }}>{props.patches.length} REUSABLE</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable
            tooltip="Choose several PNG, JPG, or WebP files in one picker"
            onPress={() => { void importImages(); }}
            style={{ height: 25, paddingLeft: 9, paddingRight: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 5, backgroundColor: accentFor('segActiveBg'), borderWidth: 1, borderColor: accentFor('primary'), opacity: importing ? 0.55 : 1 }}
          >
            <Icon name="FolderPlus" size={11} color={accentFor('primary')} />
            <Text style={{ color: accentFor('primary'), fontSize: 9, fontWeight: '900' }}>{importing ? 'IMPORTING' : 'IMPORT IMAGES…'}</Text>
          </Pressable>
          <Pressable onPress={props.onClose} style={{ width: 25, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: accentFor('border') }}>
            <Icon name="X" size={11} color={accentFor('textDim')} />
          </Pressable>
        </Row>

        <Row style={{ height: 29, alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 8, backgroundColor: accentFor('controlBg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 5 }}>
          <Icon name="Search" size={11} color={accentFor('textFaint')} />
          <TextInput
            value={query}
            placeholder="search reusable textures…"
            onChange={(value) => { setQuery(value); setPage(0); }}
            style={{ flexGrow: 1, color: accentFor('text'), fontSize: 10 }}
          />
          <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{matches.length} MATCHES</Text>
        </Row>

        <Row style={{ flexGrow: 1, minHeight: 0, gap: 10 }}>
          <Col style={{ width: 440, minHeight: 0, gap: 7 }}>
            <ScrollView style={{ flexGrow: 1, minHeight: 0 }} showScrollbar>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {visible.map((patch) => {
                  const active = selected?.id === patch.id;
                  return (
                    <Pressable
                      key={patch.id}
                      tooltip={`${patch.name} · ${patch.width}×${patch.height}`}
                      onPress={() => setSelectedId(patch.id)}
                      style={{ width: 102, height: 76, padding: 4, gap: 3, backgroundColor: accentFor('surfaceRaised'), borderWidth: active ? 2 : 1, borderColor: active ? accentFor('primary') : accentFor('borderSoft'), borderRadius: 5 }}
                    >
                      <Image source={patch.imagePath} style={{ width: 92, height: 49 }} />
                      <Text numberOfLines={1} style={{ color: active ? accentFor('primary') : accentFor('textDim'), fontSize: 8, fontWeight: '800' }}>{patch.name}</Text>
                    </Pressable>
                  );
                })}
              </Row>
              {visible.length === 0 ? (
                <Box style={{ height: 160, alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <Icon name="ImageOff" size={20} color={accentFor('textFaint')} />
                  <Text style={{ color: accentFor('textFaint'), fontSize: 10 }}>{props.patches.length === 0 ? 'Import images to start the reusable library.' : 'No texture matches this search.'}</Text>
                </Box>
              ) : null}
            </ScrollView>
            <Row style={{ height: 25, alignItems: 'center', gap: 6 }}>
              <Pressable onPress={() => setPage(Math.max(0, activePage - 1))} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: accentFor('border') }}>
                <Icon name="ChevronLeft" size={10} color={accentFor('textDim')} />
              </Pressable>
              <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>PAGE {activePage + 1}/{maxPage + 1}</Text>
              <Pressable onPress={() => setPage(Math.min(maxPage, activePage + 1))} style={{ width: 25, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: accentFor('border') }}>
                <Icon name="ChevronRight" size={10} color={accentFor('textDim')} />
              </Pressable>
            </Row>
          </Col>

          <Col style={{ flexGrow: 1, minWidth: 0, padding: 8, gap: 7, backgroundColor: accentFor('surfaceRaised'), borderWidth: 1, borderColor: accentFor('borderSoft'), borderRadius: 6 }}>
            {selected ? (
              <>
                <Image source={selected.imagePath} style={{ width: 190, height: 190 }} />
                <Text numberOfLines={2} style={{ color: accentFor('text'), fontSize: 11, fontWeight: '900' }}>{selected.name}</Text>
                <Text style={{ color: accentFor('textFaint'), fontSize: 8, fontFamily: 'ui-monospace' }}>{selected.width}×{selected.height} SOURCE PX</Text>
                <Box style={{ flexGrow: 1 }} />
                <Pressable
                  onPress={() => props.onUse(selected)}
                  style={{ height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: accentFor('primary') }}
                >
                  <Text style={{ color: '#071015', fontSize: 9, fontWeight: '900' }}>USE TEXTURE</Text>
                </Pressable>
              </>
            ) : (
              <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: accentFor('textFaint'), fontSize: 9 }}>No texture selected.</Text>
              </Box>
            )}
          </Col>
        </Row>
      </Col>
    </Box>
  );
}
