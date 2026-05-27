import React from 'react';
import { Box } from '../../../runtime/primitives';
import { C } from '../style.cls';
import * as db from '../db';
import { listPromptFiles, listGeneratedImages } from '../fs';

export default function DashboardPage() {
  const [stats, setStats] = React.useState({
    prompts: 0,
    jobs: 0,
    completed: 0,
    failed: 0,
    images: 0,
    keys: 0,
  });

  React.useEffect(() => {
    try {
      const jobs = db.listJobs(1000);
      const completed = jobs.filter((j) => j.state === 'completed').length;
      const failed = jobs.filter((j) => j.state === 'failed').length;
      const images = jobs.reduce((sum, j) => sum + (j.stats?.totalImages || 0), 0);
      setStats({
        prompts: listPromptFiles().length,
        jobs: jobs.length,
        completed,
        failed,
        images,
        keys: db.listApiKeys().length,
      });
    } catch {}
  }, []);

  const Metric = ({ label, value }: { label: string; value: number | string }) => (
    <C.AppPanel style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <C.AppMetric>{value}</C.AppMetric>
      <C.AppDim>{label}</C.AppDim>
    </C.AppPanel>
  );

  return (
    <C.AppBody>
      <C.AppPanel>
        <C.AppPanelTitle>Overview</C.AppPanelTitle>
        <C.AppSubtle>Image generation dashboard and telemetry.</C.AppSubtle>
      </C.AppPanel>

      <C.AppRow>
        <Metric label="Prompts" value={stats.prompts} />
        <Metric label="Jobs" value={stats.jobs} />
        <Metric label="Completed" value={stats.completed} />
        <Metric label="Failed" value={stats.failed} />
      </C.AppRow>

      <C.AppRow>
        <Metric label="Images Generated" value={stats.images} />
        <Metric label="API Keys" value={stats.keys} />
      </C.AppRow>

      <C.AppPanel>
        <C.AppPanelTitle>Quick Start</C.AppPanelTitle>
        <Box style={{ flexDirection: 'column', gap: 8 }}>
          <C.AppSubtle>1. Add an API key in Settings.</C.AppSubtle>
          <C.AppSubtle>2. Create or edit prompts in Prompts.</C.AppSubtle>
          <C.AppSubtle>3. Run a single job in Generate or batch jobs in Queue.</C.AppSubtle>
          <C.AppSubtle>4. View results and telemetry in Results.</C.AppSubtle>
        </Box>
      </C.AppPanel>
    </C.AppBody>
  );
}
