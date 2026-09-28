/**
 * What this device remembers about the player: so far, only whether they have
 * been through the tutorial.
 *
 * This is the first value the game persists. It uses `localStorage`, which works
 * in the Capacitor WebView and adds no runtime dependency. Storage can be missing
 * or wiped — a private window, or iOS clearing WebView storage under pressure —
 * and then the player is simply offered the tutorial again. Every read and write
 * is guarded, so a storage failure can never stop the game from starting.
 */

export const TUTORIAL_KEY = 'toneboom.tutorial';

/** The two calls this needs, so a test can hand in its own. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The device's `localStorage`, or null where it cannot be reached. */
export function deviceStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Some browsers throw on the property access itself when storage is blocked.
    return null;
  }
}

/** Whether the tutorial has been finished or skipped on this device. */
export function hasSeenTutorial(store: KeyValueStore | null = deviceStore()): boolean {
  try {
    return store?.getItem(TUTORIAL_KEY) === 'done';
  } catch {
    return false;
  }
}

/** Remember that the tutorial has been finished or skipped. */
export function markTutorialSeen(store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(TUTORIAL_KEY, 'done');
  } catch {
    // Nothing to do: the worst case is being offered it once more.
  }
}
