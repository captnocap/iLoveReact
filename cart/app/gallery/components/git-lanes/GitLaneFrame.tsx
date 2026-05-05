import type { ReactNode } from 'react';
import { classifiers as S } from '@reactjit/core';
import { Box } from '@reactjit/runtime/primitives';
import { Search } from '@reactjit/runtime/icons/icons';
import { Icon } from '@reactjit/runtime/icons/Icon';
import type { GitActivity } from '../../data/overstock/git-activity';
import { gitToneColor } from './gitLaneShared';

export type GitLaneFrameProps = {
  row: GitActivity;
  children?: ReactNode;
  width?: number;
  height?: number;
};

function LiveBadge({ live }: { live: boolean }) {
  return (
    <S.InlineX3>
      <S.Dot style={{ backgroundColor: live ? gitToneColor('ok') : gitToneColor('neutral') }} />
      <S.GitTextMeta>{live ? 'LIVE' : 'IDLE'}</S.GitTextMeta>
    </S.InlineX3>
  );
}

function GitTopbarDivider() {
  return <Box style={{ width: 1, height: 12, backgroundColor: gitToneColor('neutral') }} />;
}

export function GitLaneFooter({ row }: { row: GitActivity }) {
  return (
    <S.GitLaneFooter>
      {row.footerActions.map((action) => (
        <S.GitFooterAction key={`${action.key}-${action.label}`}>
          <S.GitKeycap>
            <S.GitTextMeta noWrap>{action.key}</S.GitTextMeta>
          </S.GitKeycap>
          <S.GitTextMeta noWrap>{action.label}</S.GitTextMeta>
        </S.GitFooterAction>
      ))}
      <S.Spacer />
      <S.GitTextTitle noWrap>{row.refreshEta}</S.GitTextTitle>
    </S.GitLaneFooter>
  );
}

export function GitLaneFrame({ row, children, width, height }: GitLaneFrameProps) {
  return (
    <S.GitLaneFrame style={{ width: width ?? '100%', height: height ?? 320 }}>
      <S.GitLaneTopbar>
        <S.GitTextTitle>{row.title}</S.GitTextTitle>
        <S.Spacer />
        <S.GitTextMeta>{row.branch}</S.GitTextMeta>
        <GitTopbarDivider />
        <S.GitTextMeta>{`${row.workerCount} WORKERS`}</S.GitTextMeta>
        <GitTopbarDivider />
        <S.GitTextMeta>{`FOCUS ${row.focusSha}`}</S.GitTextMeta>
        <GitTopbarDivider />
        <LiveBadge live={row.live} />
      </S.GitLaneTopbar>
      {children || (
        <S.GitLaneBody>
          <S.GitLaneSearchRow>
            <Icon icon={Search} size={12} color={gitToneColor('accent')} strokeWidth={2.1} />
            <S.GitTextGhost>{row.searchLabel}</S.GitTextGhost>
            <S.Spacer />
            <S.GitTextTitle>{`${row.resultCount}/${row.totalCount}`}</S.GitTextTitle>
          </S.GitLaneSearchRow>
        </S.GitLaneBody>
      )}
      <GitLaneFooter row={row} />
    </S.GitLaneFrame>
  );
}
