// MemoryPanel — local embedding + retrieval over Claude transcripts.
//
// Uses useEmbed (runtime/hooks/useEmbed) against a GGUF embedding
// model the user provides. The store slug is hard-pinned to
// 'claudewrap-transcripts' so multiple sessions of this cart share
// the same vector DB.
//
// Ingest pulls from ~/.claude/projects/<slug>/*.jsonl — the same
// JSONL files the bridge scrapes for end_turn responses. Query is a
// plain text input; results are listed with their display_text +
// rerank score (when a reranker is configured).

import * as React from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '../../../runtime/primitives';
import { palette } from '../ui/palette';
import { useEmbed, type EmbedHit } from '../../../runtime/hooks/useEmbed';
import { claudeProjectDir, envGet } from '../bridge/common';

const DEFAULT_MODEL = '~/Models/Qwen3-Embedding-0.6B-Q8_0.gguf';
const STORE_SLUG = 'claudewrap-transcripts';

function expand(path: string): string {
  if (path.startsWith('~/')) {
    const home = envGet('HOME') || '/tmp';
    return home + path.slice(1);
  }
  return path;
}

export function MemoryPanel() {
  const [modelPath, setModelPath] = React.useState(DEFAULT_MODEL);
  const [queryText, setQueryText] = React.useState('');
  const [hits, setHits] = React.useState<EmbedHit[]>([]);

  const expanded = expand(modelPath);
  const { ready, error, query, startIngest, cancelIngest, ingest } = useEmbed({
    model: expanded,
    storeSlug: STORE_SLUG,
  });

  const runQuery = React.useCallback(() => {
    if (!ready) return;
    const r = query(queryText, { k: 8, sourceType: 'chat-log-chunk' });
    setHits(r);
  }, [ready, query, queryText]);

  const projectDir = claudeProjectDir();

  return (
    <Col style={{ gap: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>memory</Text>
      <Text style={{ color: palette.dim }}>
        embedding-backed transcript RAG · store: {STORE_SLUG}
      </Text>

      <Row style={{ gap: 1 }}>
        <Text style={{ color: palette.dim, width: 8 }}>model</Text>
        <Box style={{
          flexGrow: 1,
          borderWidth: 1,
          borderColor: palette.border,
          paddingLeft: 1, paddingRight: 1,
        }}>
          <TextInput
            value={modelPath}
            placeholder={DEFAULT_MODEL}
            onChangeText={setModelPath}
          />
        </Box>
        <Text style={{ color: ready ? palette.good : palette.warn }}>
          {ready ? 'ready' : 'loading'}
        </Text>
      </Row>
      {error && (
        <Text style={{ color: palette.bad }}>{error}</Text>
      )}

      <Text> </Text>
      <Row style={{ gap: 1 }}>
        <Text style={{ color: palette.dim, fontWeight: 'bold' }}>ingest</Text>
        <Text style={{ color: palette.dim }}>{projectDir}</Text>
        <Box style={{ flexGrow: 1 }} />
        {!ingest.running && (
          <Pressable onPress={() => startIngest(projectDir, 4, 'log')}>
            <Text style={{ color: palette.accent }}>[start]</Text>
          </Pressable>
        )}
        {ingest.running && (
          <Pressable onPress={cancelIngest}>
            <Text style={{ color: palette.bad }}>[cancel]</Text>
          </Pressable>
        )}
      </Row>
      {ingest.running && (
        <Text style={{ color: palette.dim }}>
          {ingest.files_done}/{ingest.files_total} files · {ingest.chunks_done} chunks · {ingest.current_file}
        </Text>
      )}
      {ingest.done && (
        <Text style={{ color: palette.good }}>
          done: {ingest.files_done} files, {ingest.chunks_done} chunks
          {ingest.error && ` · err: ${ingest.error}`}
        </Text>
      )}

      <Text> </Text>
      <Row style={{ gap: 1 }}>
        <Text style={{ color: palette.dim, fontWeight: 'bold', width: 8 }}>query</Text>
        <Box style={{
          flexGrow: 1,
          borderWidth: 1,
          borderColor: palette.border,
          paddingLeft: 1, paddingRight: 1,
        }}>
          <TextInput
            value={queryText}
            placeholder="permission denied · why did claude reject ·…"
            onChangeText={setQueryText}
            onSubmitEditing={runQuery}
          />
        </Box>
        <Pressable onPress={runQuery}>
          <Text style={{ color: palette.accent }}>[search]</Text>
        </Pressable>
      </Row>

      <ScrollView style={{ flexGrow: 1 }}>
        {hits.map((h, i) => (
          <Col key={i} style={{ gap: 0, paddingBottom: 1 }}>
            <Row style={{ gap: 1 }}>
              <Text style={{ color: palette.info }}>#{i + 1}</Text>
              <Text style={{ color: palette.dim }}>
                {h.dense_score.toFixed(3)}
                {h.rerank_score !== undefined && ` / ${h.rerank_score.toFixed(3)}`}
              </Text>
              <Text style={{ color: palette.dim }}>{h.source_id}</Text>
            </Row>
            <Text style={{ color: palette.ink }}>{h.display_text}</Text>
          </Col>
        ))}
        {hits.length === 0 && ready && (
          <Text style={{ color: palette.dim }}>(no hits — try ingesting first)</Text>
        )}
      </ScrollView>
    </Col>
  );
}
