/**
 * Every word the player can read, in English: the source every other
 * language translates.
 *
 * Keys are grouped by the screen that shows them. `{name}` marks a value filled
 * in at run time; a translation must keep every one it is given. A value with
 * `|` in it is a list (the pop words), one item between each pair. Comments give
 * the room a string has on a 320px phone where that is tight.
 *
 * Kept as they are in every language: Tone Boom, BOOM!, AI1, AI2, AI3, AGI, P1
 * and P2.
 */
export const EN = {
  // ── Main menu ────────────────────────────────────────────────────────────
  // Four big buttons drawn on the menu, about 20 characters each at most.
  // The middle two name the opponent: the computer (vsAi) and a person on the
  // same device (vsFriend). They were "1 player" and "2 players" until
  // 2026-09-29, which read as the same thing as Solo.
  'menu.solo': 'Solo',
  'menu.vsAi': 'vs AI',
  'menu.vsFriend': 'vs Friend',
  'menu.options': 'Options',
  // The small buttons along the bottom, three or four side by side: short.
  'menu.help': 'Help',
  'menu.fullScreen': 'Full screen',
  'menu.exitFullScreen': 'Exit full screen',
  // The X on the menu that closes the game (Android only); its name for screen readers.
  'menu.close': 'Close',
  'menu.audioOn': 'Audio on',
  'menu.audioOff': 'Audio off',
  // The flag button's name for screen readers, and the title of its screen.
  'menu.language': 'Language',
  'menu.keys': 'Main menu. Arrow keys move, Enter chooses.',
  // Words that float up over the menu now and then; short, upper case.
  'menu.pops': 'BOND!|BOOM!|PEEL!|LOCK!|COMBO!|SLOT!|PERFECT!',

  // ── Shared buttons ───────────────────────────────────────────────────────
  'common.close': 'Close',
  'common.back': 'Back',
  'common.skip': 'Skip',
  'common.cancel': 'Cancel',

  // ── Help ─────────────────────────────────────────────────────────────────
  'help.title': 'How to play',
  'help.replay': 'Replay tutorial',
  'help.records': 'Records',
  'help.sounds': 'Sound preview',
  'records.title': 'Records',
  'records.solo': 'Solo — highest score',
  // The Records screen's sections. Under the two-player one, columns headed P1,
  // P2 and P1 % (kept as they are); under vs AI, YOU (hud.you), records.them
  // and %; under the best scores, the AIs' names.
  'records.ai': 'vs AI — wins',
  // The best scores against each AI, one row per mode, one column per AI.
  'records.aiBest': 'vs AI — best score',
  // Heads the AI's wins under vs AI, beside YOU and YOU %: two or three letters.
  'records.them': 'AI',
  'records.duel': 'vs Friend — wins',
  'records.none': 'No matches yet',
  // Marks the AI the ladder will play next, after its name: "AI2 · next".
  'records.next': 'next',
  'sounds.title': 'Sound preview',

  // ── The rules ────────────────────────────────────────────────────────────
  // The five things to know, one short line each (tutorial end, seat card).
  'rules.core.1': 'Aim — it fires by itself.',
  'rules.core.1.release': 'Aim, then let go to throw.',
  'rules.core.2': 'Same colours lock.',
  'rules.core.3': 'A different colour, thrown hard, booms.',
  'rules.core.4': 'Black sticks to anything.',
  'rules.core.5': 'White booms anything.',
  // The rules card on the Help screen: a short label, then a sentence or two.
  'rules.aim.label': 'Aim',
  'rules.aim.text': 'Drag to aim; farther is harder. It fires by itself when the ring fills.',
  'rules.aim.text.release': 'Drag to aim; farther is harder. Let go to throw — up to 3 balls in a row, and the ring adds one each time it fills.',
  'rules.lock.label': 'Lock',
  'rules.lock.text': 'Same colours stick together.',
  'rules.boom.label': 'Boom',
  'rules.boom.text': 'A different colour, thrown hard — a deep red arrow — booms the whole group. Bigger booms pay more.',
  // Shown under the boom rule on the help card when the mode's smallest boom is above 2.
  'rules.boom.min': 'On this mode a group needs {n} balls to boom; a smaller one only loses a ball.',
  'rules.peel.label': 'Knock loose',
  'rules.peel.text': 'Too soft, and only one ball comes off.',
  'rules.black.label': 'Black',
  'rules.black.text': 'Sticks to any colour, and survives every boom but a white one.',
  'rules.white.label': 'White',
  'rules.white.text': 'Booms whatever it touches, black included.',
  'rules.two.label': 'Two players',
  'rules.two.text': 'Each of you owns your half — drag in it to aim. Both launchers fire together.',
  'rules.two.text.release': 'Each of you owns your half — drag in it to aim, and let go to throw.',

  // ── Credits ──────────────────────────────────────────────────────────────
  'credits.title': 'Credits',
  'credits.by': 'A game by Tony M. T. L.',
  'credits.sound': 'Every sound is synthesized as you play.',
  'credits.type': 'Type: Montserrat and Outfit, under the SIL Open Font License.',
  'credits.built': 'Built with Capacitor, under the MIT License.',
  'credits.licenses': 'Open source licenses',

  // ── Tutorial ─────────────────────────────────────────────────────────────
  // The banner: a line and, under it, a smaller one. Two short lines on a
  // 360px phone at most. Colours are never named, only black and white.
  'tut.title': 'How to play',
  'tut.aim.line': 'Drag anywhere to aim.',
  'tut.aim.sub': 'Farther means harder.',
  'tut.lock.line': 'Same colours stick.',
  'tut.lock.sub': 'Lock one onto the pair.',
  'tut.boom.line': 'A different colour, thrown hard, booms the whole group.',
  'tut.boom.sub': 'Drag farther, until the arrow is deep red.',
  'tut.black.line': 'The black ball sticks to any colour.',
  'tut.black.sub': 'Lock it onto the pair.',
  'tut.white.line': 'The white ball booms whatever it touches.',
  'tut.white.sub': 'Even softly. Even the black.',
  'tut.touched.line': 'It fires by itself when the ring fills.',
  'tut.touched.sub': 'Drag again to aim the next one.',
  'tut.firstLock.line': 'Keep building.',
  'tut.firstLock.sub': 'Make it four.',
  'tut.tooHard.line': 'Gently — a soft throw sticks better.',
  'tut.peel.line': 'Too soft — that only knocked one loose.',
  'tut.peel.sub': 'Pull farther.',
  'tut.again.line': 'Not quite.',
  'tut.again.sub': 'Drag to aim, and try again.',
  'tut.hint.line': 'Try it like this.',
  'tut.hint.sub': 'Drag to where the circle stops.',
  'tut.done.aim': 'Nice.',
  'tut.done.lock': 'A group.',
  'tut.done.boom.line': 'That boom paid +{boom}.',
  'tut.done.boom.sub': 'Building it paid +{lock}. Bigger pays more.',
  'tut.done.black.line': 'Black sticks to anything.',
  'tut.done.black.sub': 'Its locks pay double.',
  'tut.done.white.line': 'White booms anything.',
  'tut.done.white.sub': "It's the only way to clear black.",
  'tut.card.title': "You're ready",
  // {time} is the match length, such as 2:00.
  'tut.card.small': 'Most points in {time} wins.',
  'tut.card.smallEndless': 'Most points wins.',
  // The closing card's last line on the way into Solo, where there is no one to beat.
  'tut.card.smallSolo': 'You have {time}. Score all you can.',
  'tut.card.start': 'Start game',
  'tut.card.menu': 'Back to menu',

  // ── Before a match ───────────────────────────────────────────────────────
  'offer.title': 'New to Tone Boom?',
  'offer.sub': 'A one-minute lesson on the five things to know.',
  'offer.show': 'Show me',
  // The two-player seat card, one on each half of the table.
  'seat.title': 'This half is yours.',
  'seat.aim': 'Drag in it to aim.',
  'seat.flat': 'Lay the device flat between you.',
  'seat.tap': 'Tap when ready',
  'seat.ready': 'Ready',
  // The countdown's last word before play, in the small clock box: short.
  'countdown.start': 'Start!',

  // ── During a match ───────────────────────────────────────────────────────
  // Score labels in the strip, beside a number up to 9999 and the clock: at
  // most about 6 characters, upper case.
  'hud.you': 'YOU',
  'hud.score': 'SCORE',
  'hud.biggest': 'biggest boom',
  'hud.booms': 'booms',
  'hud.destroyed': 'balls destroyed',
  // The buttons under the table, four in a row: short.
  'bar.pause': 'Pause',
  'bar.unpause': 'Unpause',
  'bar.menu': 'Back to Menu',
  'pause.title': 'PAUSED',
  'pause.hint': 'Tap anywhere to resume',
  'exit.title': 'Exit to Main Menu?',
  'exit.sub': 'Current game progress will be lost.',
  'exit.exit': 'Exit',

  // ── Results ──────────────────────────────────────────────────────────────
  'res.score': 'Score',
  'res.draw': 'Draw',
  'res.won': 'You Won',
  'res.lost': 'You Lost',
  'res.beatAgi': 'You Beat AGI',
  'res.gameOver': 'Game Over',
  'res.total': 'total',
  'res.connections': 'locks',
  'res.booms': 'booms',
  'res.knocked': 'knocked loose',
  'res.again': 'Play again',
  'res.modes': 'Next match mode',
  'res.prevMode': 'Previous mode',
  'res.nextMode': 'Next mode',
  // Words that float over the winner's results; short (about 9 characters),
  // upper case, drawn large.
  'res.pops': 'WINNER!|VICTORY!|PERFECT!|AMAZING!|SUPERB!|BRAVO!|CHAMP!',
  // The same, bigger, for beating AGI, the top of the AI ladder.
  'res.agiPops': 'BEAT AGI!|LEGEND!|GODLIKE!|UNREAL!|HUMANS 1|NO WAY!|HISTORIC!|TITAN!|MASTER!',
  // Under the results table. {preset} is a preset's name, {score} a number.
  'rec.newHigh': 'New highest score',
  'rec.first': '{preset} · first record',
  'rec.previous': '{preset} · previous {score}',
  'rec.highestOn': 'Highest score on {preset}: {score}',
  // {ai} is an AI's name: AI1, AI2, AI3 or AGI.
  'ladder.next': 'Next: {ai}',
  'ladder.back': 'Back to {ai}',
  'ladder.again': 'Again: {ai}',
  'ladder.top': '{ai} stays the one to beat.',
  'ladder.newBest': 'New best against {ai} on {preset}: {score}',
  'ladder.best': 'Best against {ai} on {preset}: {score}',
  'ladder.forced': '{ai}, set in Options. The ladder does not move.',

  // ── Score pops on the table ──────────────────────────────────────────────
  // The word beside a big boom's points, by size: "+13 SUPER". Upper case.
  'tier.double': 'DOUBLE',
  'tier.super': 'SUPER',
  'tier.mega': 'MEGA',
  'tier.giga': 'GIGA',

  // ── Presets ──────────────────────────────────────────────────────────────
  // Names of the six ways to play, and the player's own three: short.
  'preset.normal': 'Normal',
  'preset.relax': 'Relax',
  'preset.chaos': 'Chaos',
  'preset.cascade': 'Cascade',
  'preset.drift': 'Drift',
  'preset.rally': 'Rally',
  'preset.custom': 'Custom {n}',

  // ── Options ──────────────────────────────────────────────────────────────
  'panel.title': 'Options & Adjustments',
  'panel.preset': 'Preset',
  'panel.presetLabel': 'preset',
  // Markup: the <b> tags stay.
  'panel.presetHint': 'Pick <b>Custom 1</b>, <b>2</b> or <b>3</b> to change the rules, motion and sound yourself. Each keeps its own settings.',
  'panel.basics': 'Basics',
  'panel.rules': 'Rules',
  'panel.motion': 'Motion',
  'panel.breaking': 'Breaking',
  'panel.sound': 'Sound',
  'panel.settings': 'Settings',
  'panel.copy': 'Copy these settings',
  'panel.copied': 'Copied',
  // Each knob: a label beside its slider (a narrow column: two short words at
  // most), then what it does, under it.
  'knob.fire.label': 'firing',
  'knob.fire.hint': 'Automatic: the launcher throws by itself each time the ring fills. On release: it throws every time you let go, as fast as you tap, up to 3 balls; the ring adds one ball each time it fills.',
  'knob.labels.label': 'ball shapes',
  'knob.labels.hint': 'Draws a shape on every ball, one per colour, so colours can be told apart without relying on their hue. Off unless you turn it on.',
  'knob.vol.label': 'volume',
  'knob.vol.hint': 'Loudness of the whole game. Above 100% boosts it, for a quiet phone speaker.',
  'knob.haptics.label': 'haptics',
  'knob.haptics.hint': 'Short vibrations on booms and locks, on phones that have them.',
  'knob.ailevel.label': 'AI opponent',
  'knob.ailevel.hint': 'Who you play in vs AI. Ladder: a win moves you up to a stronger AI, a loss down to a weaker one, and losing to AGI starts again from AI1. Pick one AI to play only that one: its wins still count, but the ladder stays put and no best score is kept.',
  'knob.specials.label': 'black & white',
  'knob.specials.hint': 'The two special balls. Black sticks to any colour and survives every boom but a white one. White booms whatever it touches, black included.',
  'knob.white.label': 'white chance',
  'knob.white.hint': 'How often the player who is behind gets a white ball. The readout is the chance for each new ball. 0 turns white off and leaves black.',
  'knob.colours.label': 'colours',
  'knob.colours.hint': 'How many ball colours are in play. More colours means fewer matches, so groups grow more slowly and booms are smaller.',
  'knob.stats.label': 'damage panel',
  'knob.stats.hint': 'A small panel during the match: the biggest boom, how many booms, and how many balls destroyed.',
  'knob.match.label': 'match length',
  'knob.match.hint': 'How long a match lasts.',
  'knob.size.label': 'ball size',
  'knob.size.hint': 'The size of every ball. Bigger balls are easier to hit and fill the table sooner.',
  'knob.rain.label': 'rain interval',
  'knob.rain.hint': 'Balls that drop onto the table by themselves. Auto drops one only while the table is running low. A time drops one that often, however full the table is.',
  'knob.shotdecay.label': 'repeat hits pay',
  'knob.shotdecay.hint': 'One throw can score several times as the balls keep hitting. Each further score from the same throw pays this much of the one before: ×0.50 halves it each time; no decay pays every one in full.',
  'knob.roll.label': 'roll time',
  'knob.roll.hint': 'How long a ball keeps rolling before it stops. Longer means more collisions from every throw.',
  'knob.bounce.label': 'bounce',
  'knob.bounce.hint': 'How much speed a ball keeps when it hits another ball; walls keep a little less. 100% is fully bouncy; lower is deader.',
  'knob.spin.label': 'spin',
  'knob.spin.hint': 'How much a hit off-centre turns a group round. At 0 groups slide without turning.',
  'knob.kick.label': 'throw speed',
  'knob.kick.hint': 'Multiplies the speed of every throw. Higher sends balls farther and makes a boom easier to reach.',
  'knob.reload.label': 'shot every',
  'knob.reload.hint': "Time between one launcher's throws: how long you have to aim each ball.",
  'knob.boom.label': 'boom at',
  'knob.boom.hint': 'How hard a throw must be to boom a group. Softer hits stick or knock one ball loose. Lower makes booms easier; the aim arrow turns red where a throw will boom.',
  'knob.maxpower.label': 'max power',
  'knob.maxpower.hint': 'The hardest throw the launcher makes, before the throw speed multiplies it. The speed cap can hold a ball below it.',
  'knob.kickout.label': 'knock-loose speed',
  'knob.kickout.hint': 'How fast a ball knocked off a group flies, as a share of max power. The second figure is how much of that range is fast enough to boom another group: a chain.',
  'knob.spread.label': 'boom debris',
  'knob.spread.hint': 'How fast the balls of a boomed group scatter, compared with the hit that boomed it. Higher throws debris farther, into other groups.',
  'knob.speedcap.label': 'speed cap',
  'knob.speedcap.hint': 'The fastest any group can move, however hard it is hit. Lower keeps the table calmer.',
  'knob.minboom.label': 'smallest boom',
  'knob.minboom.hint': 'The fewest balls a group needs before it can boom. A smaller group only loses a ball, however hard it is hit.',
  'knob.lock.label': 'lock sound',
  'knob.lock.hint': 'Volume of the note when same colours stick together.',
  'knob.brk.label': 'break sound',
  'knob.brk.hint': 'Volume of the sound when a bond between two balls breaks.',
  'knob.drone.label': 'drone',
  'knob.drone.hint': 'Volume of the soft hum under a match. 0 turns it off.',
  'knob.clicks.label': 'knocks',
  'knob.clicks.hint': 'Volume of the knock when balls hit each other or a wall, and of each throw.',
  'knob.boomvol.label': 'boom sound',
  'knob.boomvol.hint': 'Volume of booms, the loudest sound in the game.',
  'knob.boomcut.label': 'boom low cut',
  'knob.boomcut.hint': 'Cuts the deepest part of every boom, below this pitch. Raise it if booms crackle or rattle on a phone speaker; lower it on headphones for more rumble.',
  'knob.locktone.label': 'lock tone',
  'knob.locktone.hint': "How bright the black ball's electric lock sounds. Lower is darker and softer, higher is sharper.",
  'knob.latency.label': 'audio buffer',
  'knob.latency.hint': 'How far ahead sound is prepared. Raise it if sound crackles or drops out; lower it if sounds come late. Auto lets the device choose. Changing it restarts the sound.',
  // Readouts beside a slider, in a narrow column: very short.
  'fmt.on': 'on',
  'fmt.fire.auto': 'automatic',
  'fmt.fire.release': 'on release',
  'fmt.off': 'off',
  'fmt.ladder': 'ladder',
  'fmt.auto': 'auto',
  'fmt.noDecay': 'no decay',
  'fmt.none': 'none',
  'fmt.endless': 'endless',

  // ── Sound preview ────────────────────────────────────────────────────────
  // The technical figures under each sound stay in English; these are its name,
  // its group and when it plays.
  'sound.play': '► Play',
  'sound.cat.gameFx': 'Game FX',
  'sound.cat.boomLevels': 'Boom Levels',
  'sound.cat.bwLevels': 'Black & White Levels',
  'sound.cat.system': 'System & UI',
  // A size band of booms: {range} such as 5-10, {balls} such as 5..9.
  'sound.tier': 'Level {range} ({balls} balls)',
  'sound.bond.name': 'Bond Lock',
  'sound.bond.situation': 'Two balls of matching type collide and form a permanent energy bond line',
  'sound.black_attach.name': 'Black Ball Magnet Lock',
  'sound.black_attach.situation': 'A coloured ball or group attaches to a black ball with an electric arc zap and magnetic suction snap',
  'sound.break.name': 'Bond Break',
  'sound.break.situation': 'A bond line between balls is severed by high-speed impact or ghost ball detachment',
  'sound.boom.name': 'Boom — {tier}',
  'sound.boom_l0.situation': 'Small boom (2 to 4 balls destroyed by a high-power cue shot)',
  'sound.boom_l1.situation': 'Medium boom (5 to 9 bonded balls destroyed)',
  'sound.boom_l2.situation': 'Large boom (10 to 14 balls destroyed, with a heavy bass voice)',
  'sound.boom_l3.situation': 'Massive boom (15 to 19 balls) with 808 sub-drop layer',
  'sound.boom_l4.situation': 'Epic mega boom (20+ balls) with thunderous sub-drop layer',
  'sound.thud_hit.name': 'Ball Collision Knock',
  'sound.thud_hit.situation': 'Physical impact collision between two unbonded balls or against table boundaries',
  'sound.thud_swoosh.name': 'Ball Launch Swoosh (Standard)',
  'sound.thud_swoosh.situation': 'Player releases a normal color ball or black ball cue shot sweeping across table',
  'sound.white_swoosh.name': 'White Ball Launch Swoosh (Metallic)',
  'sound.white_swoosh.situation': 'Player releases the white cue ball — a metal sheet swung past the ear, one resonator bank per side',
  'sound.cd_tick.name': 'Countdown Tick',
  'sound.cd_tick.situation': 'Clock counting down each second at match start or final 10 seconds of match',
  'sound.cd_go.name': 'Countdown GO! / Finish',
  'sound.cd_go.situation': 'Match start moment ("Start!") or match final timer end ("0")',
  'sound.ui_click.name': 'Binaural UI Click',
  'sound.ui_click.situation': 'Menu button presses, option toggles, or pausing the game',
  'sound.drone_toggle.name': 'Ambient Binaural Drone',
  'sound.drone_toggle.situation': 'Continuous background ambient drone playing binaural beats during gameplay',
  // {tier} is a size band (sound.tier); {n} a number of balls.
  'sound.wb.name': 'White-on-Black Boom — {tier}',
  'sound.wb.situation': 'A white cue ball reaches a {n}-ball group holding a black — the only way a black is destroyed',
  'sound.lock.single.name': 'Black Magnet Lock — {tier}',
  'sound.lock.single.situation': 'A coloured ball or group locks onto a black, closing a {n}-ball group',
  'sound.lock.pair.name': 'Black + Black Magnet Lock — {tier}',
  'sound.lock.pair.situation': 'Two blacks lock to each other, closing a {n}-ball group',

  // ── Web landing page (home.html, at / on the website) ──────────────────
  // What the game is, in a line and a short paragraph; the Play and Install
  // buttons; the screenshot's description for screen readers; three facts;
  // and the store line. Room is generous: this is a scrolling web page.
  'home.tagline': 'Physics billiards you play by ear.',
  'home.lead': 'Lock matching colours. Hit a group hard with a different one and it booms. Every collision plays a note of the same scale.',
  'home.play': 'Play now',
  'home.install': 'Install',
  'home.shot': 'A vs AI match in progress',
  'home.f1': 'Solo, against an AI ladder up to AGI, or with a friend on one phone.',
  'home.f2': 'Six modes, from a calm three minutes to a one-minute sprint.',
  'home.f3': 'Plays in the browser, works offline, installs to your home screen.',
  // How to install from the browser, now that the game is on the web only
  // (Google Play paused 2026-10-09). Name the browsers' own menu items as
  // they read in this language. home.by comes before the studio name, TMTL.
  'home.installTitle': 'Put it on your home screen',
  'home.installAndroid': 'Android: in Chrome, open the ⋮ menu and tap Install app.',
  'home.installIos': 'iPhone and iPad: in Safari, tap Share, then Add to Home Screen.',
  'home.by': 'Made by',
  'home.privacy': 'Privacy',
} as const;

