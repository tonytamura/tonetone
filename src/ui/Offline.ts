/**
 * Offline play on the web: register the service worker that `npm run
 * build:web` writes (scripts/build-web.ts). Once a page has been opened, the
 * game, the landing page and every language load without a connection, and
 * "Add to Home Screen" opens the game full screen.
 *
 * Only in a production web build served over https: the dev server has no
 * worker, and the Android and iOS apps already carry every file.
 */
import { isNativeApp } from './Platform';

export function registerOffline(): void {
  if (!import.meta.env.PROD || isNativeApp()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  // After load, so caching the files never competes with the first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* no worker, no offline: the page still works */ });
  });
}
