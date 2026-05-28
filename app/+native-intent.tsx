import { SCREENSHOT_DEMO } from '@/lib/screenshot-demo';

export function redirectSystemPath({
  path,
}: { path: string; initial: boolean }) {
  if (SCREENSHOT_DEMO && path) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return '/';
}
