/**
 * The rules, in words, written once.
 *
 * Three screens say them: the tutorial's closing card, the two-player seat card
 * and the help screen's rules card. They read from here, so a rule changed in
 * one place cannot go on being described the old way in another.
 */

/** The five things to know, one short line each. */
export const CORE_RULES: readonly string[] = [
  'Aim — it fires by itself.',
  'Same colours lock.',
  'A different colour, thrown hard, booms.',
  'Black sticks to anything.',
  'White booms anything.',
];

/** The rules card: the same rules at a little more length, and the ones play teaches. */
export const RULE_ROWS: readonly { label: string; text: string }[] = [
  { label: 'Aim', text: 'Drag to aim; farther is harder. It fires by itself when the ring fills.' },
  { label: 'Lock', text: 'Same colours stick together.' },
  { label: 'Boom', text: 'A different colour, thrown hard — a deep red arrow — booms the whole group. Bigger booms pay more.' },
  { label: 'Knock loose', text: 'Too soft, and only one ball comes off.' },
  { label: 'Black', text: 'Sticks to any colour, and survives every boom but a white one.' },
  { label: 'White', text: 'Booms whatever it touches, black included.' },
  { label: 'Two players', text: 'Each of you owns your half — drag in it to aim. Both launchers fire together.' },
];
