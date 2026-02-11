/**
 * Preview — Right pane that renders the user's component.
 */

import React from 'react';
import { Box, Text } from '../ilovereact/shared/src';

interface PreviewProps { UserComponent: React.ComponentType | null; errors: string[]; }

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: any },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: any) { super(props); this.state = { hasError: false, errorMessage: '' }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, errorMessage: error?.message || String(error) }; }
  componentDidUpdate(prev: any) { if (prev.resetKey !== this.props.resetKey && this.state.hasError) this.setState({ hasError: false, errorMessage: '' }); }
  render() {
    if (this.state.hasError) return (
      <Box style={{ padding: 16, backgroundColor: '#2d1b1b', borderRadius: 8, margin: 12 }}>
        <Text style={{ color: '#f87171', fontSize: 13, fontWeight: 'bold' }}>Runtime Error</Text>
        <Box style={{ height: 8 }} />
        <Text style={{ color: '#fca5a5', fontSize: 12 }}>{this.state.errorMessage}</Text>
      </Box>
    );
    return this.props.children;
  }
}

export function Preview({ UserComponent, errors }: PreviewProps) {
  const hasErrors = errors.length > 0;
  return (
    <Box style={{ width: '50%', height: '100%', backgroundColor: '#11111b' }}>
      <Box style={{ height: 32, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: '#1e293b' }}>
        <Text style={{ color: '#cdd6f4', fontSize: 12, fontWeight: 'bold' }}>Preview</Text>
        {hasErrors && (
          <Box style={{ backgroundColor: '#7f1d1d', paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4 }}>
            <Text style={{ color: '#fca5a5', fontSize: 9 }}>ERROR</Text>
          </Box>
        )}
      </Box>
      {/* ilr-ignore-next-line */}
      <Box style={{ flexGrow: 1, overflow: 'scroll', padding: 12 }}>
        {hasErrors ? (
          <Box style={{ padding: 16, backgroundColor: '#2d1b1b', borderRadius: 8 }}>
            {errors.map((err, i) => (
              <Box key={i} style={{ paddingBottom: i < errors.length - 1 ? 8 : 0 }}>
                <Text style={{ color: '#fca5a5', fontSize: 12 }}>{err}</Text>
              </Box>
            ))}
          </Box>
        ) : UserComponent ? (
          <ErrorBoundary resetKey={UserComponent}><UserComponent /></ErrorBoundary>
        ) : (
          <Box style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#45475a', fontSize: 14 }}>Type JSX to see it render here</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
