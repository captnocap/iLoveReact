import React from 'react';
import { Box, ScrollView } from '../../../runtime/primitives';
import { C } from '../style.cls';
import * as db from '../db';

export default function ResultsPage() {
  const [jobs, setJobs] = React.useState<db.Job[]>([]);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try { setJobs(db.listJobs(50)); } catch {}
  }, []);

  const refresh = () => {
    try { setJobs(db.listJobs(50)); } catch {}
  };

  const selectedJob = selectedJobId ? db.getJob(selectedJobId) : null;
  const batches = selectedJobId ? db.listBatchesForJob(selectedJobId) : [];

  const stateColor = (state: string) => {
    switch (state) {
      case 'completed': return 'theme:success';
      case 'failed': return 'theme:error';
      case 'running': return 'theme:warning';
      default: return 'theme:textDim';
    }
  };

  return (
    <C.AppBody>
      <Box style={{ flexDirection: 'row', gap: 'theme:spacingMd', flexGrow: 1 }}>
        <C.AppPanel style={{ width: 320, flexShrink: 0 }}>
          <C.AppPanelTitle>Jobs</C.AppPanelTitle>
          <C.AppButtonOutline onPress={refresh}>
            <C.AppButtonOutlineLabel>Refresh</C.AppButtonOutlineLabel>
          </C.AppButtonOutline>
          <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }}>
            <Box style={{ flexDirection: 'column', gap: 4 }}>
              {jobs.length === 0 ? (
                <C.AppDim>No jobs yet.</C.AppDim>
              ) : (
                jobs.map((job) => (
                  <C.AppListItem
                    key={job.id}
                    onPress={() => setSelectedJobId(job.id)}
                    style={{
                      backgroundColor: selectedJobId === job.id ? 'theme:bgElevated' : undefined,
                    }}
                  >
                    <Box style={{ flexDirection: 'column', flexGrow: 1, gap: 1 }}>
                      <C.AppListItemText>{job.prompt_name}</C.AppListItemText>
                      <C.AppListItemDim>
                        {job.state} · {job.stats?.totalImages || 0} images · {new Date(job.created_at || '').toLocaleTimeString()}
                      </C.AppListItemDim>
                    </Box>
                  </C.AppListItem>
                ))
              )}
            </Box>
          </ScrollView>
        </C.AppPanel>

        <C.AppPanel style={{ flexGrow: 1 }}>
          {selectedJob ? (
            <Box style={{ flexDirection: 'column', gap: 10, flexGrow: 1 }}>
              <C.AppPanelTitle>{selectedJob.prompt_name}</C.AppPanelTitle>
              <Box style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <C.AppBadge><C.AppBadgeText>State: {selectedJob.state}</C.AppBadgeText></C.AppBadge>
                <C.AppBadge><C.AppBadgeText>Batches: {selectedJob.stats?.successfulBatches || 0}/{selectedJob.stats?.totalBatches || 0}</C.AppBadgeText></C.AppBadge>
                <C.AppBadge><C.AppBadgeText>Images: {selectedJob.stats?.totalImages || 0}</C.AppBadgeText></C.AppBadge>
                {selectedJob.last_error && (
                  <C.AppBadge style={{ backgroundColor: 'theme:error' }}>
                    <C.AppBadgeText style={{ color: '#ffffff' }}>Error: {selectedJob.last_error}</C.AppBadgeText>
                  </C.AppBadge>
                )}
              </Box>

              <C.AppSubtle>Prompt:</C.AppSubtle>
              <Box style={{ padding: 10, borderRadius: 8, backgroundColor: 'theme:bgAlt' }}>
                <C.AppDim>{selectedJob.prompt_text}</C.AppDim>
              </Box>

              <C.AppPanelTitle>Batches</C.AppPanelTitle>
              <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1 }}>
                <Box style={{ flexDirection: 'column', gap: 4 }}>
                  {batches.map((b) => (
                    <Box
                      key={b.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        padding: 8,
                        borderRadius: 6,
                        backgroundColor: b.state === 'completed' ? 'theme:bgAlt' : 'theme:bg',
                        borderWidth: 1,
                        borderColor: b.state === 'completed' ? 'theme:success' : b.state === 'failed' ? 'theme:error' : 'theme:border',
                      }}
                    >
                      <C.AppBadgeText>#{b.batch_index}</C.AppBadgeText>
                      <Box style={{ flexDirection: 'column', flexGrow: 1 }}>
                        <C.AppListItemText>{b.state} · {b.image_count} images</C.AppListItemText>
                        {b.error && <C.AppListItemDim style={{ color: 'theme:error' }}>{b.error}</C.AppListItemDim>}
                        {b.elapsed_ms && <C.AppListItemDim>{b.elapsed_ms}ms</C.AppListItemDim>}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </ScrollView>
            </Box>
          ) : (
            <C.AppDim>Select a job to view details.</C.AppDim>
          )}
        </C.AppPanel>
      </Box>
    </C.AppBody>
  );
}
