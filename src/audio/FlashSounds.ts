import { AudioStore, isStopped } from './SynthEngine';
import { BoomProfile, playNote, playRandomGameBoom } from './Voices';
import { clickHz, playBinauralClick } from './UiSounds';
import { Flash } from '../physics/Types';

/**
 * The sound an attract-screen flash makes, the same on the title screen and the
 * results celebration. They used to map the kinds differently: the results
 * screen boomed on a `blocked` ring, which in a match is a refused launch.
 *
 * - `bond` — a lock note, as a ball locking makes in a match.
 * - `break` — a peel note.
 * - `spawn` — a boom drawn from the sizes a match produces (`profile`): in a
 *   match that ring marks debris striking a group, which is what booms.
 * - `blocked` — the interface's "no" click, and only once audio is running: on a
 *   stopped context it would sit queued and go off with everything on the tap.
 *
 * `rel` picks the scale degree for a note; a random one when there is no ball.
 */
export function playFlashSound(kind: Flash['kind'], xNorm: number, profile: BoomProfile, rel = Math.random()) {
  if (kind === 'blocked') {
    if (AudioStore.actx && !isStopped(AudioStore.actx)) playBinauralClick(clickHz('cancel'), 0.2, xNorm, 'hover');
    return;
  }
  if (kind === 'spawn') { playRandomGameBoom(xNorm, profile); return; }
  playNote(rel, xNorm, kind === 'break' ? 'break' : 'bond', profile === 'celebration' ? { boost: 0.6 } : {});
}
