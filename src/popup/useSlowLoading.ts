import { useEffect, useState } from 'react';

/** Loads faster than this never get a spinner - the flash costs more than it explains. */
const SPINNER_DELAY_MS = 250;

/**
 * True only once a load has been running long enough to be worth interrupting
 * the UI for.
 *
 * Everything here reads from `chrome.history` / `chrome.storage.local`, which
 * usually answers within a few milliseconds. Swapping content for a spinner on
 * every filter or range change made the layout jump without ever showing the
 * user anything readable.
 */
export function useSlowLoading(isLoading: boolean, delayMs = SPINNER_DELAY_MS): boolean {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setIsSlow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [isLoading, delayMs]);

  return isSlow;
}
