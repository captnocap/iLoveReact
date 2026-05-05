import { classifiers as S } from '@reactjit/core';
import { Graph } from '@reactjit/runtime/primitives';
import type { GitActivity } from '../../data/overstock/git-activity';
import {
  GIT_LANE_ROW_HEIGHT,
  GIT_LANE_X_OFFSET,
  GIT_LANE_X_STEP,
  GIT_LANE_Y_OFFSET,
  gitToneColor,
} from './gitLaneShared';

export type GitLaneGraphProps = {
  row: GitActivity;
  width?: number;
  height?: number;
  rowHeight?: number;
};

function laneX(lane: number): number {
  return GIT_LANE_X_OFFSET + lane * GIT_LANE_X_STEP;
}

function rowY(row: number, rowHeight: number): number {
  return GIT_LANE_Y_OFFSET + row * rowHeight;
}

function circlePath(x: number, y: number, r: number): string {
  return `M ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y}`;
}

export function GitLaneGraph({
  row,
  width = 84,
  height,
  rowHeight = GIT_LANE_ROW_HEIGHT,
}: GitLaneGraphProps) {
  const maxRow = Math.max(
    row.commits.length - 1,
    ...row.lanePoints.map((point) => point.row),
    ...row.laneSegments.map((segment) => Math.max(segment.fromRow, segment.toRow)),
    0
  );
  const graphHeight = height ?? Math.max(96, GIT_LANE_Y_OFFSET * 2 + (maxRow + 1) * rowHeight);

  return (
    <S.GitLaneGraphSurface style={{ width, height: graphHeight }}>
      <S.BareGraph>
        {row.laneSegments.map((segment) => {
          const x1 = laneX(segment.fromLane);
          const y1 = rowY(segment.fromRow, rowHeight);
          const x2 = laneX(segment.toLane);
          const y2 = rowY(segment.toRow, rowHeight);
          const midY = Math.round((y1 + y2) / 2);
          const d = x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
          return (
            <Graph.Path
              key={segment.id}
              d={d}
              stroke={gitToneColor(segment.tone)}
              strokeWidth={1.5}
              fill="none"
              strokeDasharray={segment.dashed ? '2,3' : undefined}
              opacity={segment.dashed ? 0.72 : 0.9}
            />
          );
        })}
        {row.lanePoints.map((point) => {
          const x = laneX(point.lane);
          const y = rowY(point.row, rowHeight);
          const color = gitToneColor(point.tone);
          const r = point.kind === 'focus' ? 4.5 : point.kind === 'branch' ? 4 : 3.8;
          const hollow = point.kind === 'branch' || point.kind === 'merge';
          return (
            <Graph.Path
              key={point.id}
              d={circlePath(x, y, r)}
              fill={hollow ? 'none' : color}
              stroke={color}
              strokeWidth={point.kind === 'focus' ? 2 : 1.5}
            />
          );
        })}
      </S.BareGraph>
    </S.GitLaneGraphSurface>
  );
}
