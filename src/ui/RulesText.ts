/**
 * The rules, in words, written once.
 *
 * Three screens say them: the tutorial's closing card, the two-player seat card
 * and the help screen's rules card. They read from here, so a rule changed in
 * one place cannot go on being described the old way in another.
 */

import { t } from '../i18n/I18n';
import { FIRE_ON_RELEASE } from '../game/Rules';

/**
 * The five things to know, one short line each, in the player's language. How a
 * throw leaves depends on the `fire` option: by itself, or on letting go.
 */
export function coreRules(release = FIRE_ON_RELEASE): string[] {
  return [t(release ? 'rules.core.1.release' : 'rules.core.1'), t('rules.core.2'), t('rules.core.3'), t('rules.core.4'), t('rules.core.5')];
}

/** The rules card: the same rules at a little more length, and the ones play teaches. */
export function ruleRows(release = FIRE_ON_RELEASE): { label: string; text: string }[] {
  return (['aim', 'lock', 'boom', 'peel', 'black', 'white', 'two'] as const).map(r => ({
    label: t(`rules.${r}.label`),
    text: t(r === 'aim' && release ? 'rules.aim.text.release' : `rules.${r}.text`),
  }));
}
