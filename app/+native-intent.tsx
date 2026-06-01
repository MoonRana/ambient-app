import { SCREENSHOT_DEMO } from '@/lib/screenshot-demo';

export function redirectSystemPath({
  path,
}: { path: string; initial: boolean }) {
  // Demo mode: ScreenshotDemoSeed in _layout handles full deep links (path + query).
  if (SCREENSHOT_DEMO) {
    return '/';
  }
  if (path) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return '/';
}
