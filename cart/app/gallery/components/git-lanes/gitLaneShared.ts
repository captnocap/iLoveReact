import { classifiers as S } from '@reactjit/core';
import type { GitActivity, GitCommitEntry, GitLaneTone } from '../../data/overstock/git-activity';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';

export const GIT_LANE_ROW_HEIGHT = 24;
export const GIT_LANE_X_STEP = 15;
export const GIT_LANE_X_OFFSET = 15;
export const GIT_LANE_Y_OFFSET = 12;

export function getSelectedCommit(row: GitActivity): GitCommitEntry {
  return row.commits.find((commit) => commit.id === row.selectedCommitId) || row.commits[0];
}

export function gitToneColor(tone: GitLaneTone): string {
  switch (tone) {
    case 'worker1':
    case 'blue':
      return CTRL.blue;
    case 'worker2':
    case 'flag':
      return CTRL.flag;
    case 'worker3':
    case 'warn':
      return CTRL.warn;
    case 'worker4':
    case 'ok':
      return CTRL.ok;
    case 'worker5':
    case 'lilac':
      return CTRL.lilac;
    case 'neutral':
      return CTRL.inkDim;
    case 'main':
    case 'accent':
    default:
      return CTRL.accent;
  }
}

export function gitToneText(tone: GitLaneTone): any {
  switch (tone) {
    case 'worker1':
    case 'blue':
      return S.GitTextBlue;
    case 'worker2':
    case 'flag':
      return S.GitTextFlag;
    case 'worker3':
    case 'warn':
      return S.GitTextWarn;
    case 'worker4':
    case 'ok':
      return S.GitTextOk;
    case 'worker5':
    case 'lilac':
      return S.GitTextLilac;
    case 'neutral':
      return S.GitTextDim;
    case 'main':
    case 'accent':
    default:
      return S.GitTextAccent;
  }
}

export function signedCount(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

export function displaySha(value: string): string {
  return value.replace(/-/g, '·');
}

export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
