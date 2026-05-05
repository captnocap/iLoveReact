import { classifiers as S } from '@reactjit/core';
import type { GitActivity, GitCommitEntry } from '../../data/overstock/git-activity';
import { clampText, displaySha, getSelectedCommit, gitToneColor, gitToneText, signedCount } from './gitLaneShared';

export type GitCommitRailRowProps = {
  row: GitActivity;
  commit?: GitCommitEntry;
  compact?: boolean;
  detail?: boolean;
  showSwatch?: boolean;
};

export function GitCommitRailRow({
  row,
  commit = getSelectedCommit(row),
  compact = false,
  detail = false,
  showSwatch = row.mode !== 'lanes-detail',
}: GitCommitRailRowProps) {
  const selected = commit.selected || commit.id === row.selectedCommitId;
  const RowFrame = selected ? S.GitCommitRowActive : commit.alert ? S.GitCommitRowAlert : S.GitCommitRow;
  const ShaText = gitToneText(commit.tone);
  const WorkerText = gitToneText(commit.workerTone);
  const MessageText = commit.alert ? S.GitTextFlag : S.GitTextInk;
  const message = commit.displayMessage || commit.message;
  const maxMessage = detail ? 30 : compact ? 28 : 32;

  if (detail) {
    return (
      <RowFrame>
        <MessageText noWrap style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
          {clampText(message, maxMessage)}
        </MessageText>
        <WorkerText noWrap style={{ width: 38 }}>
          {commit.worker}
        </WorkerText>
        <S.GitTextDim noWrap style={{ width: 8 }}>
          ·
        </S.GitTextDim>
        <S.GitTextDim noWrap style={{ width: 34 }}>
          {commit.age}
        </S.GitTextDim>
      </RowFrame>
    );
  }

  return (
    <RowFrame>
      {compact ? <S.GitTextGhost style={{ width: 42 }}>{commit.time}</S.GitTextGhost> : null}
      {showSwatch ? (
        <S.GitLegendSwatch style={{ width: 10, height: 10, backgroundColor: gitToneColor(commit.tone) }} />
      ) : null}
      <ShaText noWrap style={{ width: compact ? 56 : 62 }}>
        {displaySha(commit.sha)}
      </ShaText>
      <MessageText noWrap style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
        {clampText(message, maxMessage)}
      </MessageText>
      <WorkerText noWrap style={{ width: compact ? 38 : 42 }}>
        {commit.worker}
      </WorkerText>
      <S.GitTextDim noWrap style={{ width: compact ? 26 : 30 }}>
        {commit.age}
      </S.GitTextDim>
      {compact ? null : (
        <S.GitTextDim noWrap style={{ width: 32 }}>
          {`${commit.files}F`}
        </S.GitTextDim>
      )}
      <S.GitTextOk noWrap style={{ width: compact ? 28 : 34, textAlign: 'right' }}>
        {signedCount(commit.additions)}
      </S.GitTextOk>
      <S.GitTextFlag noWrap style={{ width: compact ? 24 : 30, textAlign: 'right' }}>
        {`-${commit.deletions}`}
      </S.GitTextFlag>
    </RowFrame>
  );
}
