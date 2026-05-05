import { classifiers as S } from '@reactjit/core';
import type { GitActivity, GitCommitEntry, GitDiffFile, GitDiffLine } from '../../data/overstock/git-activity';
import { clampText, displaySha, getSelectedCommit, gitToneText, signedCount } from './gitLaneShared';

export type GitDiffPreviewProps = {
  row: GitActivity;
  commit?: GitCommitEntry;
};

const DASHES = Array.from({ length: 19 });

function splitFilePath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf('/');
  if (index < 0) return { dir: '', base: path };
  return {
    dir: path.slice(0, index + 1),
    base: path.slice(index + 1),
  };
}

function DashRule() {
  return (
    <S.InlineX2 style={{ paddingLeft: 40, paddingRight: 10, height: 1, overflow: 'hidden' }}>
      {DASHES.map((_, index) => (
        <S.GitDash key={index} />
      ))}
    </S.InlineX2>
  );
}

function DiffFileRow({ file, last }: { file: GitDiffFile; last: boolean }) {
  const path = splitFilePath(file.path);
  return (
    <S.StackX1>
      <S.GitDiffFileRow>
        <S.GitTextTitle style={{ width: 18 }}>{file.status === 'added' ? '+' : file.status === 'deleted' ? 'D' : 'M'}</S.GitTextTitle>
        <S.InlineX2 style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          {path.dir ? <S.GitTextFileDir noWrap>{path.dir}</S.GitTextFileDir> : null}
          <S.GitTextFileBase noWrap>{path.base}</S.GitTextFileBase>
        </S.InlineX2>
        <S.GitTextOk style={{ width: 34, textAlign: 'right' }}>{signedCount(file.additions)}</S.GitTextOk>
        <S.GitTextFlag style={{ width: 28, textAlign: 'right' }}>{`-${file.deletions}`}</S.GitTextFlag>
      </S.GitDiffFileRow>
      {last ? null : <DashRule />}
    </S.StackX1>
  );
}

function DiffLine({ line }: { line: GitDiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <S.GitDiffCodeLine>
        <S.GitTextHunk noWrap>{line.line || '@@'}</S.GitTextHunk>
      </S.GitDiffCodeLine>
    );
  }

  const LineFrame = line.kind === 'add' ? S.GitDiffCodeAdd : line.kind === 'remove' ? S.GitDiffCodeRemove : S.GitDiffCodeLine;
  const TextFrame = line.kind === 'add' ? S.GitTextOk : line.kind === 'remove' ? S.GitTextFlag : S.GitTextDim;

  return (
    <LineFrame>
      <TextFrame noWrap>{clampText(line.text, 48)}</TextFrame>
    </LineFrame>
  );
}

export function GitDiffPreview({ row, commit = getSelectedCommit(row) }: GitDiffPreviewProps) {
  const WorkerText = gitToneText(commit.workerTone);

  return (
    <S.GitLaneDetailPane>
      <S.GitLaneDetailHeader>
        <S.InlineX4Center>
          <S.BadgeAccent style={{ borderRadius: 0, paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1 }}>
            <S.GitTextBadgeSha>{displaySha(commit.sha)}</S.GitTextBadgeSha>
          </S.BadgeAccent>
          <WorkerText>{commit.worker}</WorkerText>
          <S.Spacer />
          <S.GitTextDim>{`${commit.time}Z · ${commit.age}`}</S.GitTextDim>
        </S.InlineX4Center>
        <S.GitTextDetailTitle>{commit.message}</S.GitTextDetailTitle>
        <S.InlineX4>
          <S.GitTextOk>{signedCount(commit.additions)}</S.GitTextOk>
          <S.GitTextFlag>{`-${commit.deletions}`}</S.GitTextFlag>
          <S.GitTextDetailMeta>{`${commit.files} FILES`}</S.GitTextDetailMeta>
          <S.GitTextDetailMeta>1 HUNK EACH</S.GitTextDetailMeta>
        </S.InlineX4>
      </S.GitLaneDetailHeader>

      <S.StackX1>
        {row.diffFiles.map((file, index) => (
          <DiffFileRow key={file.path} file={file} last={index === row.diffFiles.length - 1} />
        ))}
      </S.StackX1>

      <S.StackX1 style={{ paddingTop: 7 }}>
        {row.diffLines.map((line) => (
          <DiffLine key={line.id} line={line} />
        ))}
      </S.StackX1>
    </S.GitLaneDetailPane>
  );
}
