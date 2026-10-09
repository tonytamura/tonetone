/**
 * Turning the frame's `SoundEvent` records into sound.
 *
 * The collision solver used to call the voices directly. That meant physics could
 * not be read or tested without the audio module loaded, `boomGroup`/`detach`
 * carried a `width` parameter they wanted only for stereo pan, and the pan and
 * pitch formulas were written out at every call site. The solver now records what
 * happened, in world coordinates, and this module is the one place that knows how
 * a world position becomes a pan and a ball kind becomes a pitch.
 *
 * The frame loop drains the events once, after the last physics substep, so a
 * sound is heard a few milliseconds later than it used to be — inside the
 * scheduling look-ahead the voices already use.
 */
import { SoundEvent } from '../physics/Types';
import { boomTier, playBoom, playNote, playKnock, playMagneticElectricSound, relOfDegree } from './Voices';
import { triggerHaptic } from './SynthEngine';

/** The knock force that maps to full loudness. Harder hits are clamped to it. */
export const KNOCK_FULL_SCALE_FORCE = 380;

/**
 * World x to a stereo pan of -1 (hard left) to 1 (hard right).
 *
 * A width of 0 or less pans to centre rather than dividing by it. The old call
 * sites fell back to a literal 600 when width was missing, which was neither the
 * browser's width nor the harness's 380; nothing reaches this without a real
 * width now that the frame loop supplies it.
 */
export function panOf(x: number, width: number): number {
  if (!(width > 0)) return 0;
  return (x / width) * 2 - 1;
}

/**
 * The scale step each ball colour plays, indexed by kind: 0-4 are the five steps
 * of the scale, 5 is the root an octave up.
 *
 * The first three colours — all a default match uses — take steps 1, 3 and 5:
 * A, C and F. They were chosen while the panel still offered several scales,
 * because those steps are where scales differ most; with Hirajoshi alone they
 * give the default match its most characteristic notes.
 *
 * A colour's step does not depend on how many colours are in play, so adding a
 * colour never retunes the ones already on the table.
 */
export const KIND_DEGREES: readonly number[] = [0, 2, 4, 1, 3, 5];

/**
 * A ball kind to the 0..1 position in the scale its note is drawn from.
 * Special balls (a negative kind) sit in the middle.
 */
export function pitchOf(kind: number): number {
  if (kind < 0) return 0.5;
  return relOfDegree(KIND_DEGREES[kind % KIND_DEGREES.length]);
}

/** Play every sound the frame recorded, then empty the list. */
export function playSoundEvents(sounds: SoundEvent[], width: number): void {
  for (const s of sounds) {
    const pan = panOf(s.x, width);
    switch (s.type) {
      case 'boom':
        // Straight to `playBoom`, not through `playNote`. The boom path there
        // reads neither a scale degree nor a boost, so routing through it meant
        // computing both on the belief that they mattered.
        // Felt as well as heard, in a match only: the attract screens call
        // `playBoom` too, and a menu that buzzes in the hand is not wanted.
        if (playBoom(s.size, pan, { whiteBlack: s.whiteBlack })) {
          const tier = boomTier(s.size);
          triggerHaptic(tier >= 3 ? 'heavy' : tier >= 1 ? 'medium' : 'light');
        }
        break;
      case 'peel':
        playNote(pitchOf(s.kind), pan, 'break');
        break;
      case 'lock':
        playNote(pitchOf(s.kind), pan, 'bond');
        break;
      case 'knock':
        playKnock(
          pan,
          Math.min(1, s.force / KNOCK_FULL_SCALE_FORCE),
          pitchOf(s.hitterKind),
          pitchOf(s.struckKind)
        );
        break;
      case 'magnetLock':
        playMagneticElectricSound(pan, { isPair: s.bothBlack, groupSize: s.size });
        break;
    }
  }
  sounds.length = 0;
}
