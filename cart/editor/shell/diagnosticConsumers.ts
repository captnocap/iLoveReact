export type DiagnosticConsumer = {
  id: string;
  source: string;
  label: string;
  value: string;
  detail: string;
  score: number;
  hot: boolean;
};
