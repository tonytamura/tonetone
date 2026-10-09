/**
 * The rules, in words, written once.
 *
 * Three screens say them: the tutorial's closing card, the two-player seat card
 * and the help screen's rules card. They read from here, so a rule changed in
 * one place cannot go on being described the old way in another.
 */

import { t } from '../i18n/I18n';
import { FIRE_ON_RELEASE } from '../game/Rules';
import { PhysicsConfig } from '../physics/Config';

/**
 * The five things to know, one short line each, in the player's language. How a
 * throw leaves depends on the `fire` option: by itself, or on letting go.
 */
export function coreRules(release = FIRE_ON_RELEASE): string[] {
  return [t(release ? 'rules.core.1.release' : 'rules.core.1'), t('rules.core.2'), t('rules.core.3'), t('rules.core.4'), t('rules.core.5')];
}

/**
 * The rules card: the same rules at a little more length, and the ones play
 * teaches. Read when the card opens, so it describes the mode in force: how a
 * throw leaves (`release`), and the smallest group that can boom (`minBoom`),
 * which is 3 on Relax, Cascade, Drift and Rally, where a pair hit hard only
 * loses a ball.
 */
export function ruleRows(release = FIRE_ON_RELEASE, minBoom = PhysicsConfig.MIN_BOOM): { label: string; text: string }[] {
  return (['aim', 'lock', 'boom', 'peel', 'black', 'white', 'two'] as const).map(r => {
    let text = t(release && (r === 'aim' || r === 'two') ? `rules.${r}.text.release` : `rules.${r}.text`);
    if (r === 'boom' && minBoom > 2) text += ' ' + t('rules.boom.min', { n: minBoom });
    return { label: t(`rules.${r}.label`), text };
  });
}
