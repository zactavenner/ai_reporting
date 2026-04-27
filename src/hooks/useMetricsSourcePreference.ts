import { useCallback } from 'react';

export type MetricsSource = 'sheet' | 'database';

// App is now Sheets-only. Always return 'sheet' regardless of binding state.
// setSource is a no-op kept for backwards compatibility with existing callers.
export function useMetricsSourcePreference(
  _clientId: string | undefined,
  _defaultSource: MetricsSource = 'sheet',
  _hasSheet: boolean = false,
) {
  const setSource = useCallback((_next: MetricsSource) => {}, []);
  return { source: 'sheet' as MetricsSource, setSource };
}