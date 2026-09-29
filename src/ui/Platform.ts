/**
 * Where the game is running: in the Android or iOS app, or in a browser.
 */
import { Capacitor } from '@capacitor/core';

/** True inside the Android or iOS app, which is already full screen. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
