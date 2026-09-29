# Tone Boom — working notes for code agents

A physics-based arcade billiards game: TypeScript + Vite, Canvas 2D and Web Audio
hand-written with no game-logic dependencies, packaged for iOS/Android via
Capacitor.

## Documentation and tasks live in Notion, not in this repo

**This repository holds code, tests and the simulation harness. It does not hold
the documentation.** Notion is the only home for it: read the pages there before
changing a subsystem, and write any documentation you produce there rather than
adding a Markdown file here.

- **Docs home:** [Documentation](https://app.notion.com/p/3dfdc052afb181d890bbcc0aa14c0ace)
  — start at [Design Overview](https://app.notion.com/p/3dfdc052afb1815d89a1c285532baf68),
  which indexes the rest.
- **Project page:** [Tone Boom](https://app.notion.com/p/3dfdc052afb181719a60ef22a9610f6a),
  reached through `Projetos → Lista de projetos` in the workspace tree.
- **Tasks:** [Tarefas](https://app.notion.com/p/0f7d38ac1500470ca06317c9ae60c0a5)
  (data source `collection://9d78920b-ec05-401e-bec1-7aeab7bfcaab`), an inline
  database on the project page. It belongs to Tone Boom alone — **not** the shared
  `Projetos → Tarefas` database — so every row is already a Tone Boom task and
  there is no project relation to filter by.

**Write in English** — documentation, task titles, page content, commit messages.
Everything Tone Boom owns is already English.

The field and option names are Portuguese, matching the rest of the workspace. Use
these strings verbatim when you query or set a value, and read them as:

| Field | Means | Values |
| :--- | :--- | :--- |
| `Tarefa` | task title | free text — **write new ones in English** |
| `Status` | status | `A fazer` (to do), `Fazendo` (doing), `Feito` (done) |
| `Etapa` | stage | `Backlog`, `Release 1` |
| `Prioridade` | priority | `Alta` (high), `Média` (medium), `Baixa` (low) |
| `Prazo` | due date | date |

When you finish a piece of work, update the matching Notion task and the affected
doc page in the same pass as the code. A code change that silently leaves the
Notion page describing the old behaviour is not finished.

Per-subsystem pages, all children of the docs home:

- [Game Mechanics & Rules](https://app.notion.com/p/3dfdc052afb1816187a3f69be3475c2d)
- [Scoring](https://app.notion.com/p/3dfdc052afb181749c21c88a259f161c)
- [Physics & Rigid-Body Engine](https://app.notion.com/p/3dfdc052afb1817abe5ac05dea57a117)
- [Procedural Web Audio Engine](https://app.notion.com/p/3dfdc052afb181e69d54d1ee15adb344)
- [Rendering & Visual Effects](https://app.notion.com/p/3dfdc052afb1816fb7acd41dbdde24c0)
- [User Interface & Tuning Panel](https://app.notion.com/p/3dfdc052afb181bd95abd740289ffed7)
- [Simulation Harness](https://app.notion.com/p/3dfdc052afb1812e8a39e1bbf59cbf71)
- [Tutorial: Design](https://app.notion.com/p/3dfdc052afb1817b855ed206c2e53a6d)
- [Mobile Packaging (Capacitor)](https://app.notion.com/p/3dfdc052afb1816eac26ec3ade2d4425)
- [Study: Screen Shapes and the Three Presets](https://app.notion.com/p/3e0dc052afb1811fa44def81f14a7d56)
- [Study: Cascade, Drift and Rally](https://app.notion.com/p/3e0dc052afb1815fb4dbcbab7e183050)

## Verify changes with the simulation harness

This project has a headless simulation tool. **Use it — do not reason about game
balance or physics from reading the code alone.** It runs real matches under
`node` with a seeded RNG, so results are exact and reproducible.

```bash
npm run verify          # type-check + unit tests + all three simulation gates
```

That is the full gate for any change to `src/physics/`, `src/game/` or
`src/sim/`. Run it before reporting a change as done. The individual gates:

```bash
npm test               # unit tests (379), including the harness's own
npm run sim:physics    # textbook solver results: momentum, energy, 90° separation
npm run sim:invariants # geometric invariants on every frame of 10 scenarios
npm run sim:baseline   # did this change alter how the game plays?
```

### When you change physics or rules

1. Run `npm run sim:baseline` **before** editing, to confirm a clean starting point.
2. Make the change.
3. Run `npm run verify`.
4. Read the baseline diff:
   - **No diff** means behaviour did not change. For a refactor, that is the
     result you want, and it is a strong one.
   - **A diff you intended** — re-save it in the same commit:
     `npm run sim -- baseline save`. Say in the commit message which metrics moved
     and why.
   - **A diff you did not intend** is the bug. Do not re-save the baseline to make
     it quiet.

Every command takes `--json`. Parse it with `npm run --silent`, or npm's banner
lands on stdout ahead of the JSON:

```bash
npm run --silent sim -- invariants --json
```

### When you change or add a knob

Knobs are declared once in [`src/sim/Knobs.ts`](src/sim/Knobs.ts) and consumed by
both the tuning panel and the harness. Add or change a knob in **both** the
registry and `index.html`; `tests/sim/Knobs.test.ts` fails if they disagree.

The same file declares the presets — Normal, Relax, Chaos, Cascade, Drift and
Rally. A preset is a set of differences from the registry defaults, and adding
one means adding its `<option>` to `index.html` too, before the panel's own last
options, **Custom 1**, **2** and **3**, which are not registry presets. Anything a preset touches
joins `PRESET_SPAN` and is therefore reset when a player picks a different
preset, so putting a knob in a preset changes what switching presets does to it.

Then measure it rather than describing it:

```bash
npm run sim -- sweep <knob>=<v1,v2,v3> --runs 10
npm run sim -- compare --a <knob>=<old> --b <knob>=<new> --runs 30 --mode duel
```

### When you change the game loop

`advanceFrame` in [`src/sim/Frame.ts`](src/sim/Frame.ts) is the **only** game
loop; `main.ts` and the harness both call it. Keep it that way. Do not add a
second copy of the substep rule, the turn timer or the rain cadence to either
caller — a harness that mirrors the loop instead of sharing it ends up measuring a
simulation that no longer exists.

## Reporting results

- **Never report a difference that is inside the noise.** `sweep` and `compare`
  print `mean ± standard error` and withhold a verdict unless the difference
  clears 2x that error. Repeat the phrasing they use; do not upgrade
  "inside the noise" into an effect.
- **Quote the numbers**, with their error bars, not just the direction.
- **Name the proxy's limits.** `--policy engine-ai` is the pre-ladder AI (no
  longer a ladder rung, but still what the baseline plays): it aims at the
  biggest group and never checks whether the line is clear.
  It cannot represent shot selection. If that is the skill in question, say so
  instead of reporting its number. `--policy agi` (and the `planner` strategy)
  do select shots, by simulating candidates, but they are slow to run.
  `npm run sim -- tournament` compares AI strategies head to head.
- Watch `mean boom size` next to `booms per minute`. A high rate of 2-ball
  booms is not the same game as occasional 9-ball booms, and the rate alone
  cannot tell them apart.
- The same caution applies to the five preset-quality metrics — `chainAvg` and
  `chainLongFrac` for chain depth, `blockedFrac` for refused launches,
  `liveAvg` and `starvedFrac` for table density, `leadChanges` and `catchUp`
  for how close a match stays. `blockedFrac` is normalised by launcher *time*,
  not by fire attempts: a blocked bay retries every frame, so an attempt-based
  figure overstates it several-fold.

Full guide: the [Simulation Harness](https://app.notion.com/p/3dfdc052afb1812e8a39e1bbf59cbf71)
page in Notion.

## Notify me when the work is finished

Work here often runs for minutes at a time — `npm run verify`, a high-`--runs`
`sweep` or `compare`, a native build — and by the time it is over the laptop is
probably unattended. **Send one push notification with the `PushNotification`
tool at the point you hand the session back**, whether that is because the work
is done or because you are stopped and need a decision.

- **One notification, at the end.** Not per command, per long job, or per
  milestone. Finishing a slow step in the middle of the work is not an event
  worth pulling someone away from their evening for; finishing the work is.
- **Only when the wait was long enough that nobody would still be watching.** A
  quick answer or a one-file edit needs no notification at all.
- **Lead with the outcome.** `verify green, pushed to main` and `verify failed: 3
  physics tests, nothing pushed` both say something; "task done" does not.
- **One line, under 200 characters, no markdown.** It is read on a phone.
- Nothing is lost by sending it when it turns out the terminal *was* being
  watched: the tool suppresses it and reports that it was not sent. That is the
  expected result, not a failure to retry.

### Put the results where they can be read

A `sweep` or `compare` table, a baseline diff or a screenshot is unreadable in a
phone terminal, and terminal scrollback is not reachable from another device at
all. When the result of a long job is a table or an image, send it with
`SendUserFile` or publish it as an artifact and give the link. Printing it to the
terminal as well is fine; making the terminal the only copy is not.

## Git: one branch, commit straight to it

This project is worked on a **single branch**, the one already checked out —
normally `main`. When asked to submit, commit and push there directly.

- **Do not create feature branches, do not open pull requests, and do not merge
  one branch into another.** Nothing needs a review branch to land here.
- **A session that starts in a worktree still works on `main`.** If a session
  starts inside `.claude/worktrees/…` on a generated branch, that branch is not the
  working branch — `main` is. Fast-forward the main checkout to each change once
  `npm run verify` is green (its dev server is what gets tested), and never call a
  change ready to try while it exists only on the worktree branch.
- **Do not switch branches in the working tree.** There may be uncommitted work in
  progress, and `git checkout` carries it onto the branch you move to. If a command
  needs a pristine tree — checking what a merge really produced, for instance — use
  `git worktree add --detach` into a temporary directory and remove it afterwards,
  rather than switching branches or stashing in place.
- **Never revert, stash or commit changes that are not yours.** Files here can
  change between commands, because they are being edited at the same time. A
  "clean tree" reading goes stale within seconds: re-check it immediately before
  anything that depends on it.
- **`npm run verify` is the gate.** With no pull request it is the only review step
  between a change and the branch everything ships from, so it must be green, with
  the simulation baseline unchanged, before you push.

## Conventions

- TypeScript strict mode; `tsc --noEmit` type-checks `src/` and `scripts/`.
- `tests/` mirrors `src/`. Regression repros for specific defects go in
  `tests/game/BugDetections.test.ts` as permanent guards.
- No game-logic runtime dependencies. Physics, audio synthesis and rendering are
  hand-written; the only runtime packages are the Capacitor native shims.
- `PhysicsConfig`, the `Rules` palette and `AudioStore` are module-level mutable
  singletons. Anything that tunes them must restore them — use `snapshotConfig` /
  `restoreConfig` from `src/sim/Knobs.ts`.
- For any field a slider controls, the `index.html` value wins at page load, so
  editing the literal in `physics/Config.ts` has no effect. Change the knob
  default instead. A player's saved options (`toneboom.settings`, see
  `src/ui/PlayerSettings.ts`) are applied after that, in the browser only; the
  harness never reads them.
