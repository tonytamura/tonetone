/**
 * Where the game is running: in the Android or iOS app, the website installed
 * to the home screen, or a browser tab.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/** True inside the Android or iOS app, which is already full screen. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function isIOS(): boolean {
  try {
    if (Capacitor.getPlatform() === 'ios') return true;
  } catch { /* not in the app */ }
  if (typeof navigator === 'undefined') return false;
  // iPadOS reports itself as a Mac, with touch.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  try {
    if (Capacitor.getPlatform() === 'android') return true;
  } catch { /* not in the app */ }
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
}

/**
 * The website opened from the home screen rather than in a tab: its window
 * has no browser around it (the manifest asks for full screen). Read once, at
 * start-up, before the page can have asked for full screen itself, because
 * `display-mode: fullscreen` also matches a tab put full screen by the
 * Fullscreen API.
 *
 * Never inside a frame. itch.io's "launch in fullscreen" puts its frame
 * full screen, which from inside matches `display-mode: fullscreen` too: the
 * game took itself for installed there, showed an X that could not close
 * another site's page, and hid the full screen button.
 */
export function detectInstalledWebApp(): boolean {
  if (typeof window === 'undefined' || typeof matchMedia === 'undefined') return false;
  if (window.self !== window.top) return false;
  if (document.fullscreenElement) return false;
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
const INSTALLED_WEB_APP = detectInstalledWebApp();

/**
 * Already full screen as an app: the Android or iOS app, or the website
 * installed to the home screen. The full screen buttons are hidden there:
 * they had nothing to do, and in the installed website they did nothing.
 */
export function isAppWindow(): boolean {
  return isNativeApp() || INSTALLED_WEB_APP;
}

/**
 * Whether the game offers its own full screen button: only in a browser tab of
 * its own. Not in an app window, which is full screen already, and not in a
 * frame on another site: on itch.io the browser refused it (whether a frame
 * may go full screen is the host page's to allow), and itch.io has its own.
 */
export function canOfferFullscreen(): boolean {
  if (isAppWindow()) return false;
  return typeof window === 'undefined' || window.self === window.top;
}

/**
 * How the game closes itself, where it can, or null:
 *
 * - the Android app: Capacitor's own exit;
 * - the website installed on Android: closing its window, which Chrome allows
 *   for an installed app's one-page window;
 * - nowhere on iOS, app or website: there is no way to, and Apple rejects
 *   apps that quit themselves (to the player it looks like a crash). Home is
 *   how an iPhone leaves an app;
 * - nowhere in a browser tab, which a page cannot close, nor in a frame on
 *   another site (itch.io), whose page is not the game's to close.
 *
 * Full screen hides Android's navigation bar, and swiping it back in made the
 * page resize under the player's finger, so the X on the menu is the way out.
 */
export function closeApp(): (() => void) | null {
  if (isIOS() || !isAndroid()) return null;
  if (isNativeApp()) return () => { void App.exitApp(); };
  if (INSTALLED_WEB_APP) return () => window.close();
  return null;
}
