import React from 'react';
import { Box, ScrollView, TextArea } from '../../../runtime/primitives';
import { C } from '../style.cls';
import * as db from '../db';
import { loadPromptFile } from '../fs';
import { CONFIG, VALID_ASPECT_RATIOS, VALID_RESOLUTIONS, isResolutionBasedModel } from '../config';
import { generateBatch } from '../generate';
import { loadMultipleImg2Img } from '../img2img';
import { createJob, updateJob, createBatch } from '../db';

export default function GeneratePage() {
  const [prompts, setPrompts] = React.useState<db.Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = React.useState('');
  const [customPrompt, setCustomPrompt] = React.useState('');
  const [mode, setMode] = React.useState<'preset' | 'custom'>('preset');

  const [model, setModel] = React.useState(CONFIG.DEFAULT_MODEL);
  const [width, setWidth] = React.useState(String(CONFIG.DEFAULT_WIDTH));
  const [height, setHeight] = React.useState(String(CONFIG.DEFAULT_HEIGHT));
  const [resolution, setResolution] = React.useState('auto');
  const [aspectRatio, setAspectRatio] = React.useState('auto');
  const [numImages, setNumImages] = React.useState(String(CONFIG.DEFAULT_IMAGES));
  const [numBatches, setNumBatches] = React.useState(String(CONFIG.DEFAULT_BATCHES));
  const [style, setStyle] = React.useState('');
  const [img2imgRefs, setImg2imgRefs] = React.useState('');
  const [autoRetry, setAutoRetry] = React.useState(false);

  const [running, setRunning] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);

  React.useEffect(() => {
    try { setPrompts(db.listPrompts()); } catch {}
  }, []);

  const promptText = mode === 'preset' && selectedPrompt
    ? (db.getPromptByName(selectedPrompt)?.text ?? loadPromptFile(selectedPrompt) ?? '')
    : customPrompt;

  const isResolutionBased = isResolutionBasedModel(model);

  const addLog = (line: string) => setLog((prev) => [...prev.slice(-50), line]);

  const run = async () => {
    if (!promptText.trim()) {
      addLog('Error: prompt is empty');
      return;
    }
    const apiKey = db.getActiveApiKey();
    if (!apiKey) {
      addLog('Error: no active API key. Add one in Settings.');
      return;
    }

    setRunning(true);
    setLog([]);

    const jobId = createJob({
      source: 'interactive',
      promptName: mode === 'preset' ? selectedPrompt : 'custom',
      promptText,
      options: {
        width: isResolutionBased ? undefined : parseInt(width, 10),
        height: isResolutionBased ? undefined : parseInt(height, 10),
        numImages: parseInt(numImages, 10),
        numBatches: parseInt(numBatches, 10),
        model,
        style: style || null,
        resolution: isResolutionBased ? resolution : null,
        aspect_ratio: isResolutionBased ? aspectRatio : null,
      },
      img2imgRefsPattern: img2imgRefs || null,
      state: 'running',
      stats: { totalBatches: 0, successfulBatches: 0, failedBatches: 0, totalImages: 0 },
    });

    updateJob(jobId, { started_at: new Date().toISOString() });

    let img2imgBase64: string[] = [];
    let img2imgNames: string[] = [];
    if (img2imgRefs.trim()) {
      try {
        const loaded = await loadMultipleImg2Img(img2imgRefs);
        img2imgBase64 = loaded.base64Array;
        img2imgNames = loaded.filenamesArray;
        addLog(`Loaded ${img2imgBase64.length} img2img reference(s)`);
      } catch (e: any) {
        addLog(`Img2Img load failed: ${e.message}`);
      }
    }

    const totalBatches = parseInt(numBatches, 10);
    for (let i = 0; i < totalBatches; i++) {
      const batchIndex = i + 1;
      addLog(`Starting batch ${batchIndex}/${totalBatches}...`);

      const batchId = createBatch({
        job_id: jobId,
        batch_index: batchIndex,
        state: 'running',
        image_count: 0,
      });

      try {
        const result = await generateBatch(promptText, {
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          numImages: parseInt(numImages, 10),
          model,
          style: style || null,
          resolution: isResolutionBased ? resolution : null,
          aspect_ratio: isResolutionBased ? aspectRatio : null,
        }, img2imgBase64);

        updateBatch(batchId, {
          state: 'completed',
          image_count: result.imageCount,
          saved_files: result.savedFiles,
          elapsed_ms: result.elapsedMs,
        });

        const job = db.getJob(jobId);
        if (job) {
          const stats = job.stats || {};
          stats.totalBatches = (stats.totalBatches || 0) + 1;
          stats.successfulBatches = (stats.successfulBatches || 0) + 1;
          stats.totalImages = (stats.totalImages || 0) + result.imageCount;
          updateJob(jobId, { stats });
        }

        addLog(`Batch ${batchIndex}: ${result.imageCount} image(s) in ${result.elapsedMs}ms`);
      } catch (e: any) {
        updateBatch(batchId, { state: 'failed', error: e.message });
        const job = db.getJob(jobId);
        if (job) {
          const stats = job.stats || {};
          stats.totalBatches = (stats.totalBatches || 0) + 1;
          stats.failedBatches = (stats.failedBatches || 0) + 1;
          updateJob(jobId, { stats, last_error: e.message });
        }
        addLog(`Batch ${batchIndex} failed: ${e.message}`);
      }
    }

    const finalJob = db.getJob(jobId);
    if (finalJob) {
      const allFailed = (finalJob.stats.failedBatches || 0) === totalBatches;
      updateJob(jobId, {
        state: allFailed ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
      });
    }

    setRunning(false);
    addLog('Done.');
  };

  return (
    <C.AppBody>
      <Box style={{ flexDirection: 'row', gap: 'theme:spacingMd', flexGrow: 1 }}>
        <C.AppPanel style={{ width: 300, flexShrink: 0 }}>
          <C.AppPanelTitle>Options</C.AppPanelTitle>
          <Box style={{ flexDirection: 'column', gap: 10 }}>
            <Box style={{ flexDirection: 'row', gap: 6 }}>
              <C.AppButtonOutline
                onPress={() => setMode('preset')}
                style={{ backgroundColor: mode === 'preset' ? 'theme:bgElevated' : undefined }}
              >
                <C.AppButtonOutlineLabel>Preset</C.AppButtonOutlineLabel>
              </C.AppButtonOutline>
              <C.AppButtonOutline
                onPress={() => setMode('custom')}
                style={{ backgroundColor: mode === 'custom' ? 'theme:bgElevated' : undefined }}
              >
                <C.AppButtonOutlineLabel>Custom</C.AppButtonOutlineLabel>
              </C.AppButtonOutline>
            </Box>

            {mode === 'preset' ? (
              <Box style={{ flexDirection: 'column', gap: 6 }}>
                <C.AppDim>Select prompt</C.AppDim>
                <ScrollView showScrollbar style={{ width: '100%', maxHeight: 200 }}>
                  <Box style={{ flexDirection: 'column', gap: 2 }}>
                    {prompts.map((p) => (
                      <C.AppListItem
                        key={p.id}
                        onPress={() => setSelectedPrompt(p.name)}
                        style={{
                          backgroundColor: selectedPrompt === p.name ? 'theme:bgElevated' : undefined,
                        }}
                      >
                        <C.AppListItemText>{p.name}</C.AppListItemText>
                      </C.AppListItem>
                    ))}
                  </Box>
                </ScrollView>
              </Box>
            ) : (
              <TextArea
                style={{ height: 120, padding: 10, borderRadius: 8, backgroundColor: '#111a24', borderWidth: 1, borderColor: '#2e4159', color: '#eef5ff', fontSize: 14 }}
                value={customPrompt}
                onChange={setCustomPrompt}
                placeholder="Enter prompt..."
              />
            )}

            <C.AppTextInput value={model} onChange={setModel} placeholder="Model" />

            {isResolutionBased ? (
              <>
                <C.AppTextInput value={resolution} onChange={setResolution} placeholder="Resolution (1k,2k,4k,8k,auto)" />
                <C.AppTextInput value={aspectRatio} onChange={setAspectRatio} placeholder="Aspect ratio" />
              </>
            ) : (
              <Box style={{ flexDirection: 'row', gap: 6 }}>
                <C.AppTextInput style={{ flexGrow: 1 }} value={width} onChange={setWidth} placeholder="Width" />
                <C.AppTextInput style={{ flexGrow: 1 }} value={height} onChange={setHeight} placeholder="Height" />
              </Box>
            )}

            <Box style={{ flexDirection: 'row', gap: 6 }}>
              <C.AppTextInput style={{ flexGrow: 1 }} value={numImages} onChange={setNumImages} placeholder="Images" />
              <C.AppTextInput style={{ flexGrow: 1 }} value={numBatches} onChange={setNumBatches} placeholder="Batches" />
            </Box>

            <C.AppTextInput value={style} onChange={setStyle} placeholder="Style (optional)" />
            <C.AppTextInput value={img2imgRefs} onChange={setImg2imgRefs} placeholder="Img2Img refs (comma separated)" />

            <C.AppButton onPress={run}>
              <C.AppButtonLabel>{running ? 'Running...' : 'Generate'}</C.AppButtonLabel>
            </C.AppButton>
          </Box>
        </C.AppPanel>

        <C.AppPanel style={{ flexGrow: 1 }}>
          <C.AppPanelTitle>Preview / Log</C.AppPanelTitle>
          <Box style={{ flexDirection: 'column', gap: 6, flexGrow: 1 }}>
            <C.AppSubtle>Prompt text:</C.AppSubtle>
            <Box
              style={{
                padding: 10,
                borderRadius: 8,
                backgroundColor: 'theme:bgAlt',
                borderWidth: 1,
                borderColor: 'theme:border',
              }}
            >
              <C.AppDim>{promptText || '(empty)'}</C.AppDim>
            </Box>
            <C.AppSubtle>Log:</C.AppSubtle>
            <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }}>
              <Box style={{ flexDirection: 'column', gap: 2 }}>
                {log.length === 0 ? (
                  <C.AppDim>Ready.</C.AppDim>
                ) : (
                  log.map((line, i) => <C.AppDim key={i}>{line}</C.AppDim>)
                )}
              </Box>
            </ScrollView>
          </Box>
        </C.AppPanel>
      </Box>
    </C.AppBody>
  );
}
