import { classifiers as S } from '@reactjit/core';
import type { SpreadsheetMetric } from '../../data/overstock/spreadsheet';

export type SpreadsheetMetricStripProps = {
  metrics: SpreadsheetMetric[];
};

function MetricValue({ metric }: { metric: SpreadsheetMetric }) {
  if (metric.tone === 'error') return <S.SpreadsheetErrorText>{metric.value}</S.SpreadsheetErrorText>;
  if (metric.tone === 'accent') return <S.SpreadsheetMetricAccent>{metric.value}</S.SpreadsheetMetricAccent>;
  return <S.SpreadsheetValueText>{metric.value}</S.SpreadsheetValueText>;
}

export function SpreadsheetMetricStrip({ metrics }: SpreadsheetMetricStripProps) {
  return (
    <S.SpreadsheetMetricStrip>
      {metrics.map((metric) => (
        <S.SpreadsheetMetric key={metric.id}>
          <S.SpreadsheetLabel>{metric.label}</S.SpreadsheetLabel>
          <MetricValue metric={metric} />
        </S.SpreadsheetMetric>
      ))}
    </S.SpreadsheetMetricStrip>
  );
}
