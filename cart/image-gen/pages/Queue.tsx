import React from 'react';
import { Box, ScrollView, TextArea } from '../../../runtime/primitives';
import { C } from '../style.cls';
import { loadQueueFile, saveQueueFile } from '../fs';
import { parseQueueFile, buildQueueLine, type QueueJobConfig } from '../queue';
import * as db from '../db';
import { generateBatch } from '../generate';
import { loadMultipleImg2Img } from '../img2img';
import { loadPromptFile } from '../fs';

export default function QueuePage() {
  const [content, setContent] = React.useState('');
  const [jobs, setJobs] = React.useState<QueueJobConfig[]>([]);
  const [running, setRunning] = React.useState(false);
  const [currentJob, setCurrentJob] = React.useState(0);
  const [log, setLog] = React.useState<string[]>([]);

  React.useEffect(() => {
    const raw = loadQueueFile();
    setContent(raw);
    try { setJobs(parseQueueFile(raw)); } catch {}
  }, []);

  const updateContent = (text: string) => {
    setContent(text);
    try {
      saveQueueFile(text);
      setJobs(parseQueueFile(text));
    } catch {}
  };

  const addLog = (line: string) => setLog((prev) => [...prev.slice(-50), line]);

  const runQueue = async () => {
    if (running) return;
    const configs = parseQueueFile(content);
    if (configs.length === 0) {
      addLog('No jobs in queue.');
      return;
    }
    const apiKey = db.getActiveApiKey();
    if (!apiKey) {
      addLog('No active API key.');
      return;
    }

    setRunning(true);
    setLog([]);
    setCurrentJob(0);

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      setCurrentJob(i + 1);
      addLog(`[${i + 1}/${configs.length}] ${cfg.prompt}`);

      const promptText = loadPromptFile(cfg.prompt) ?? cfg.prompt;
      const jobId = db.createJob({
        source: 'queue',
        promptName: cfg.prompt,
        promptText,
        options: cfg,
        img2imgRefsPattern: cfg.img2imgRefsPattern,
        state: 'running',
        stats: { totalBatches: 0, successfulBatches: 0, failedBatches: 0, totalImages: 0 },
      });
      db.updateJob(jobId, { started_at: new Date().toISOString() });

      let img2imgBase64: string[] = [];
      if (cfg.img2imgRefsPattern) {
        try {
          const loaded = await loadMultipleImg2Img(cfg.img2imgRefsPattern);
          img2imgBase64 = loaded.base64Array;
          addLog(`  Loaded ${img2imgBase64.length} refs`);
        } catch (e: any) {
          addLog(`  Ref load failed: ${e.message}`);
        }
      }

      for (let b = 0; b < cfg.numBatches; b++) {
        const batchIndex = b + 1;
        const batchId = db.createBatch({
          job_id: jobId,
          batch_index: batchIndex,
          state: 'running',
          image_count: 0,
        });
        try {
          const result = await generateBatch(promptText, cfg, img2imgBase64);
          db.updateBatch(batchId, {
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
            db.updateJob(jobId, { stats });
          }
          addLog(`  Batch ${batchIndex}: ${result.imageCount} images`);
        } catch (e: any) {
          db.updateBatch(batchId, { state: 'failed', error: e.message });
          const job = db.getJob(jobId);
          if (job) {
            const stats = job.stats || {};
            stats.totalBatches = (stats.totalBatches || 0) + 1;
            stats.failedBatches = (stats.failedBatches || 0) + 1;
            db.updateJob(jobId, { stats, last_error: e.message });
          }
          addLog(`  Batch ${batchIndex} failed: ${e.message}`);
        }
      }

      const finalJob = db.getJob(jobId);
      if (finalJob) {
        const failed = finalJob.stats.failedBatches || 0;
        const total = finalJob.stats.totalBatches || 0;
        db.updateJob(jobId, {
          state: failed === total ? 'failed' : 'completed',
          finished_at: new Date().toISOString(),
        });
      }
      addLog(`  Job ${i + 1} done.`);
    }

    setRunning(false);
    addLog('Queue complete.');
  };

  return (
    <C.AppBody>
      <Box style={{ flexDirection: 'row', gap: 'theme:spacingMd', flexGrow: 1 }}>
        <C.AppPanel style={{ width: 360, flexShrink: 0 }}>
          <C.AppPanelTitle>Queue Editor</C.AppPanelTitle>
          <C.AppSubtle>Edit queue.txt directly.</C.AppSubtle>
          <TextArea
            style={{ flexGrow: 1, minHeight: 200, padding: 10, borderRadius: 8, backgroundColor: '#111a24', borderWidth: 1, borderColor: '#2e4159', color: '#eef5ff', fontSize: 14 }}
            value={content}
            onChange={updateContent}
            placeholder="# Comment\n[prompt][4096x4096][1][1][seedream-v4][none][none]"
          />
          <Box style={{ flexDirection: 'row', gap: 6, justifyContent: 'space-between' }}>
            <C.AppDim>{jobs.length} job(s)</C.AppDim>
            <C.AppButton onPress={runQueue}>
              <C.AppButtonLabel>{running ? `Running ${currentJob}...` : 'Run Queue'}</C.AppButtonLabel>
            </C.AppButton>
          </Box>
        </C.AppPanel>

        <C.AppPanel style={{ flexGrow: 1 }}>
          <C.AppPanelTitle>Queue Plan</C.AppPanelTitle>
          <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }}>
            <Box style={{ flexDirection: 'column', gap: 4 }}>
              {jobs.length === 0 ? (
                <C.AppDim>No active jobs in queue.</C.AppDim>
              ) : (
                jobs.map((job, i) => (
                  <Box
                    key={i}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      padding: 8,
                      borderRadius: 6,
                      backgroundColor: 'theme:bgAlt',
                    }}
                  >
                    <C.AppBadgeText style={{ width: 24 }}>{i + 1}</C.AppBadgeText>
                    <Box style={{ flexDirection: 'column', flexGrow: 1, gap: 1 }}>
                      <C.AppListItemText>{job.prompt}</C.AppListItemText>
                      <C.AppListItemDim>
                        {job.model} · {job.resolution || `${job.width}x${job.height}`} · {job.numImages}×{job.numBatches}
                        {job.img2imgRefsPattern ? ` · refs: ${job.img2imgRefsPattern}` : ''}
                      </C.AppListItemDim>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </ScrollView>

          <C.AppPanelTitle>Log</C.AppPanelTitle>
          <ScrollView showScrollbar style={{ width: '100%', height: 160 }}>
            <Box style={{ flexDirection: 'column', gap: 2 }}>
              {log.map((line, i) => (
                <C.AppDim key={i}>{line}</C.AppDim>
              ))}
            </Box>
          </ScrollView>
        </C.AppPanel>
      </Box>
    </C.AppBody>
  );
}
