/**
 * A live readout of the audio context, for chasing the silent-return bug on a
 * phone without a debugger attached. Off unless the page is opened with
 * `?audiodebug`.
 *
 * What it tells apart: a context that is stopped (the state line says so), one
 * that claims to run while its clock stands still (the clock does not move), and
 * one that runs, keeps time and still plays nothing — the case no check in the
 * engine can see, which the readout alone can confirm.
 */
import { AudioStore, MAX_VOICES, audioLog, audioRebuilds, isAudioAsleep } from '../audio/SynthEngine';

const TICK_MS = 500;

/** Whether the page has had the user activation a browser wants before it plays sound. */
const tapped = () => {
  const ua = (navigator as any).userActivation;
  return ua ? (ua.hasBeenActive ? 'yes' : 'no') : '?';
};

export function setupAudioReadout(): void {
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('audiodebug')) return;
  const el = document.createElement('pre');
  el.id = 'audio-readout';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: '4px', top: 'calc(env(safe-area-inset-top, 0px) + 4px)', zIndex: '10000', margin: '0',
    padding: '4px 6px', font: '10px/1.3 monospace', color: '#9ff',
    background: 'rgba(0,0,0,0.7)', pointerEvents: 'none', whiteSpace: 'pre-wrap',
    maxWidth: 'calc(100vw - 8px)', boxSizing: 'border-box',
  });
  document.body.appendChild(el);
  let lastClock = 0;
  setInterval(() => {
    const a = AudioStore.actx;
    const clock = a ? a.currentTime : 0;
    const head = a
      ? `${a.state}${isAudioAsleep() ? ' (asleep)' : ''}  clock ${clock.toFixed(2)} (+${(clock - lastClock).toFixed(2)})`
      : 'no context yet';
    lastClock = clock;
    el.textContent = [
      head,
      `tapped ${tapped()}  sound ${AudioStore.soundOn ? 'on' : 'off'}  gain ${AudioStore.master?.gain.value.toFixed(2) ?? '-'}  voices ${AudioStore.activeVoices}/${MAX_VOICES}  thuds ${AudioStore.thuds}  rebuilds ${audioRebuilds()}`,
      ...audioLog(),
    ].join('\n');
  }, TICK_MS);
}
