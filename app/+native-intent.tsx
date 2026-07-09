import { SCREENSHOT_DEMO } from '@/lib/screenshot-demo';

/** Top-level route segments the app can actually render. */
const KNOWN_SEGMENTS = [
  '(tabs)',
  '(recording)',
  'login',
  'onboarding',
  'freestyle',
  'patient',
  'session-detail',
  'index',
  'consult',
  'settings',
  'history',
  'jobs',
];

export function redirectSystemPath({
  path,
}: { path: string; initial: boolean }) {
  // Demo mode: ScreenshotDemoSeed in _layout handles full deep links (path + query).
  if (SCREENSHOT_DEMO) {
    return '/';
  }
  if (!path) return '/';

  const normalized = path.startsWith('/') ? path : `/${path}`;
  const firstSegment = normalized.split('/').filter(Boolean)[0] ?? '';

  // Only forward paths that map to real routes; anything else
  // (TestFlight launch URLs, stale notification links) goes home.
  if (KNOWN_SEGMENTS.includes(firstSegment)) {
    return normalized;
  }
  return '/';
}
