import { classifiers as S } from '@reactjit/core';
import { Search } from '@reactjit/runtime/icons/icons';
import { Icon } from '@reactjit/runtime/icons/Icon';
import type { GitActivity } from '../../data/overstock/git-activity';
import { GitCommitRailRow } from './GitCommitRailRow';
import { GitDiffPreview } from './GitDiffPreview';
import { GitLaneFrame } from './GitLaneFrame';
import { GitLaneGraph } from './GitLaneGraph';
import { GIT_LANE_ROW_HEIGHT, gitToneColor } from './gitLaneShared';

export type GitLanesProps = {
  row: GitActivity;
};

function frameSize(row: GitActivity): { width: number; height: number } {
  if (row.mode === 'compact-list') return { width: 370, height: 340 };
  if (row.mode === 'graph-list') return { width: 372, height: 390 };
  return { width: 612, height: 365 };
}

function SearchRow({ row }: { row: GitActivity }) {
  return (
    <S.GitLaneSearchRow>
      <Icon icon={Search} size={12} color={gitToneColor('accent')} strokeWidth={2.1} />
      <S.GitTextGhost noWrap style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
        {row.searchLabel}
      </S.GitTextGhost>
      <S.GitTextTitle>{`${row.resultCount}/${row.totalCount}`}</S.GitTextTitle>
    </S.GitLaneSearchRow>
  );
}

function LaneLegend() {
  const lanes = [
    ['MAIN', 'main'],
    ['W·01', 'blue'],
    ['W·02', 'flag'],
    ['W·03', 'lilac'],
    ['W·04', 'ok'],
    ['W·05', 'warn'],
  ] as const;

  return (
    <S.GitLaneSearchRow>
      {lanes.map(([label, tone]) => (
        <S.InlineX2 key={label}>
          <S.GitLegendSwatch style={{ width: 7, height: 7, backgroundColor: gitToneColor(tone) }} />
          <S.GitTextMeta>{label}</S.GitTextMeta>
        </S.InlineX2>
      ))}
      <S.Spacer />
      <S.GitTextTitle>{'48/128'}</S.GitTextTitle>
    </S.GitLaneSearchRow>
  );
}

function shouldUseDetailRows(row: GitActivity, compact: boolean): boolean {
  return row.mode === 'lanes-detail' && !compact;
}

function CommitRows({
  row,
  compact = false,
  showSwatch = false,
}: {
  row: GitActivity;
  compact?: boolean;
  showSwatch?: boolean;
}) {
  return (
    <S.GitLaneList>
      {row.commits.map((commit) => (
        <GitCommitRailRow
          key={commit.id}
          row={row}
          commit={commit}
          compact={compact}
          showSwatch={showSwatch}
          detail={shouldUseDetailRows(row, compact)}
        />
      ))}
    </S.GitLaneList>
  );
}

function GraphCommitPane({ row, compact = false }: { row: GitActivity; compact?: boolean }) {
  const graphHeight = Math.max(96, row.commits.length * GIT_LANE_ROW_HEIGHT + 24);

  return (
    <S.GitLaneSplitBody>
      <S.GitLaneGraphColumn>
        <GitLaneGraph row={row} height={graphHeight} />
      </S.GitLaneGraphColumn>
      <CommitRows row={row} compact={compact} showSwatch={false} />
    </S.GitLaneSplitBody>
  );
}

function DetailLayout({ row }: { row: GitActivity }) {
  return (
    <S.GitLaneBody>
      <SearchRow row={row} />
      <S.GitLaneSplitBody>
        <S.GitLaneList>
          <GraphCommitPane row={row} />
        </S.GitLaneList>
        <GitDiffPreview row={row} />
      </S.GitLaneSplitBody>
    </S.GitLaneBody>
  );
}

function CompactListLayout({ row }: { row: GitActivity }) {
  return (
    <S.GitLaneBody>
      <SearchRow row={row} />
      <CommitRows row={row} compact showSwatch />
    </S.GitLaneBody>
  );
}

function GraphListLayout({ row }: { row: GitActivity }) {
  return (
    <S.GitLaneBody>
      <LaneLegend />
      <SearchRow row={row} />
      <GraphCommitPane row={row} compact />
    </S.GitLaneBody>
  );
}

export function GitLanes({ row }: GitLanesProps) {
  const size = frameSize(row);

  return (
    <GitLaneFrame row={row} width={size.width} height={size.height}>
      {row.mode === 'compact-list' ? (
        <CompactListLayout row={row} />
      ) : row.mode === 'graph-list' ? (
        <GraphListLayout row={row} />
      ) : (
        <DetailLayout row={row} />
      )}
    </GitLaneFrame>
  );
}
