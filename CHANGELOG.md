# Changelog

User-visible changes, newest first. Dates are the day they reached the
deployed app (push to `main` deploys the frontend; edge functions are
deployed alongside).

## 2026-07-19

### Added
- **Past training reviews on Reflect.** The Training patterns card now keeps
  its history: a "Past weeks" toggle underneath unfolds up to eleven earlier
  weeks, each with the trend that was seen and the coach's note that was
  given — so you can look back at what the advice was while you were in it.
- **The demo's composer now actually does things.** A tiny deterministic
  stand-in (no server, plain regexes) handles the classic phrasings — a task
  name from your list, "bench 60kg 3x8", "ran 5k in 25 min at 152 bpm",
  "remind me to water the plants in 10 mins" — writes real demo rows, and
  records a real undo batch, so the apply/undo/AI-log loop is finally
  demonstrable offline. Anything it can't place falls back to an honest
  explainer.
- A unit-test suite over the AI composer's apply logic (trust thresholds,
  dedupe, the action cap, deterministic time fallbacks, planned-set filling,
  reminder clearing) against an in-memory database — the most
  regression-prone path in the app is no longer guarded only by the live
  smoke test. CI also typechecks the edge functions as Deno code now.

### Changed
- **The volume picture counts sets in the week you did them.** Hard sets
  used to land on the plan week their session belonged to, so catching up on
  last week's session inflated a week you didn't actually train. Planned and
  freeform sets now both bucket by the day they were logged — the same
  calendar view the weekly coach's note reads, so the two finally agree.

### Removed
- **The Telegram bot is gone** — the one feature tied to an outside social
  platform, and the last single-user holdout. The function, its secrets and
  the setup docs are all removed; the Android share sheet remains the
  hands-free way into the composer.

### Fixed
- Background jobs (reflections, training reviews, nudge-adjacent state) now
  page through all accounts instead of silently stopping at the first ten.

## 2026-07-18

### Added
- **A weekly AI training review, in two parts.** Once a week the server reads
  your training story — the 12-week trend in sessions, hard sets and cardio
  km, plus last week's actual sets, reps, weights, muscle volumes, recovery
  check-ins and cardio feel — and writes two things: a **Training patterns**
  card on Reflect naming the clearest trend, and a **Coach's note** on the
  Workout tab with 3-5 concrete, safety-first suggestions for the coming week
  (one small increment at a time, less for anything that said "over the
  line", cardio capped at +10%). It's advisory only — the AI never touches
  your plan; you apply what you like in the plan editor. This replaces the
  old on-demand "Find my training pattern" button, which had quietly become
  unreachable; the review now generates itself and catches up automatically
  if a week's first pass is missed.
- **Four more languages: Türkçe, Русский, Čeština, 日本語.** The app now
  speaks eleven languages. As with the existing ones, the whole surface is
  covered — interface, seeded routines and plan content, the "also translate
  my content" flow, push nudges, composer answers and the weekly reflection
  (server-side text follows the new packs too).
- **"Also translate my routines & plan"** (Settings → Language): switching
  language changes the interface, but your routines, tasks and plan cues are
  data seeded in whatever language was active at sign-up. This one-tap action
  renames all standard seeded content into the current language by exact
  lookup across the language packs — no AI, works between any two languages,
  keeps all history attached, and never touches anything you wrote or renamed
  yourself. Reminder categories follow along so nothing folds into "Other".
  The flow is deliberate: languages live in a dropdown, picking one is a
  draft you confirm with Save, the app returns to Settings after the switch
  (not the Now tab), and the translation is offered once as a yes/no popup
  right after the new language loads - it never sits in the UI otherwise.
- **Exercise autocomplete**: the plan editor and the training setup card now
  suggest from 1,289 exercise names as you type, and picking one fills in the
  muscle group automatically. The database is a trimmed extract of the
  MIT-licensed exercises-dataset (names + muscle groups only, ~9 KB gzipped)
  that loads on demand — app startup and the installed size are untouched.
- **Freeform lifts now count in the volume picture.** Telling the composer
  "hammer curls 14kg 3x12" tags the log with its muscle group (your plan is
  checked first, then the exercise database), so off-plan work shows up in
  the weekly hard-set chart instead of disappearing.

## 2026-07-17

### Added
- **The AI speaks your language now.** The language you pick in Settings is
  stored with your account, and everything the server writes follows it: the
  weekly reflection is generated in that language (at its next scheduled pass —
  switching languages never triggers an extra AI call), push nudges use a
  translated string table, and the composer's answers ("what's pending?")
  come back localized. The parser also handles non-English messages
  properly — Persian/Arabic digits (۵ = 5), and time phrases like
  "dans 10 min", "ساعت ۱۸", "明天" are caught by the same deterministic
  fallbacks that already backed up English.
- **Six new languages**: Français, Español, Deutsch, 中文, العربية and فارسی
  join English. The picker appears under Settings → Language; Arabic and Farsi
  flip the whole layout right-to-left, and Farsi shows dates in the Jalali
  calendar. Everything is translated — screens, seeded routines, the starter
  plan's safety cues and the demo content (the demo reseeds itself in the
  chosen language).
- **Live demo mode**: the app now runs fully in the browser with no account
  and no backend — visit with `?demo` (linked from the README) or tap
  "Try the live demo" on the sign-in screen. A fake Supabase client backed
  by localStorage serves a believable week of routines, workouts, cardio and
  reminders; everything is interactive (check-offs, the Week grid, starting
  a training block, Reflect charts, CSV exports). The AI composer explains
  itself instead of calling a server, and a small pill labels the session
  with an Exit back to the real app.
- **Single-file translations**: every user-facing string now lives in
  `src/i18n/en.ts` — one typed file covering all screens, the seeded
  routines and the starter plan's safety cues. Adding a language is copy,
  translate, register (one import); TypeScript flags anything a translation
  misses, and a language picker appears in Settings automatically once a
  second language exists. Includes an RTL-ready `dir`/`lang` hook and
  locale-aware date formatting.

### Fixed
- The "build your own" fields on the Workout setup card no longer sit
  border-on-border — the three rows now have proper spacing in every
  language, LTR and RTL.

## 2026-07-16

### Fixed
- The bottom navigation bar no longer gets stuck floating mid-screen on
  iPhone after typing (a WebKit bug in installed PWAs: closing the on-screen
  keyboard sometimes leaves the viewport panned, taking every pinned element
  with it). The app now detects the keyboard closing and re-anchors itself —
  no more force-closing the app to fix the layout.

## 2026-07-13

### Added
- **Motion polish, second pass**: the undo toast now slides out instead of
  vanishing (and retargets smoothly if replaced mid-animation); finishing a
  routine in the Player pops the check in with a small flourish; progress
  fills (routine rails, player/session rail, cardio week bar, Reflect
  chart) animate via GPU-friendly transforms instead of width/height, so
  they stay smooth on mid-range phones; cards sit on a three-layer shadow
  that reads as depth in both themes.

### Fixed
- Long-pressing a button, label or day cell no longer starts a text
  selection — the interface reads as an app, not a web page. Text fields
  and genuinely copyable prose (an AI insight, the words you told the AI)
  stay selectable.
- Content now fades in when it first arrives from the server, instead of
  snapping in after the skeleton with no motion.
- Reopening the Reminders list is instant: it keeps its data in memory
  like the main tabs, so it no longer flashes an empty screen and reloads
  from scratch each time you come back to it.
- Reopening the installed app no longer shows a black void for a second
  while it reloads. iOS reloads PWAs on resume (and a fresh deploy reloads
  once more to update); the page now paints its own warm background and a
  small lamplight dot immediately, instead of the empty dark theme colour.

## 2026-07-12

### Added
- **Motion polish** (following Emil Kowalski's design-engineering rules):
  the Player, Workout session and Settings screens slide up on open and
  drop away on close instead of popping; the Week tab's Save/Cancel bar
  slides in and out the same way; switching tabs cross-fades the incoming
  screen instead of hard-cutting; buttons compress slightly while pressed.
  All of it is transform/opacity-only CSS and respects reduced-motion.

### Fixed
- Workout headings no longer run their subtitle into the title
  ("Block 1 — PPLweek 2 of 6" → "Block 1 — PPL week 2 of 6", same for
  "Volume picture hard sets per week").
- AI Log timestamps use the same compact "12 Jul, 14:32" shape as the
  Reminders cleared list (was the verbose locale default with seconds).
- The Week tab's Save/Cancel bar no longer covers the last routine card or
  "+ Add routine" when you're scrolled to the bottom.

## 2026-07-11

### Added
- **Timed reminders.** A reminder with a due date can carry a clock time
  ("due" and "at" fields in the Reminders screen), and a push nudge fires
  within ~5 minutes of that hour in your timezone. The nudge cron now runs
  every 5 minutes (was 15).
- **The AI understands the clock.** "remind me to call the bank tomorrow at
  5pm", "…in 10 mins" — times, relative offsets, "tomorrow"/"yesterday" are
  resolved deterministically in code, never left to the model's arithmetic.
- **The AI covers the rest of the app's inputs**: clearing an open reminder
  by saying it happened ("bought the sunscreen" — status change, undoable),
  checking tasks for past days ("did the dishes yesterday"), cardio with
  heart rate and recovery feel ("ran 5k in 25 min at 152 bpm, felt easy"),
  and read-only "what's pending?" questions.
- Changelog (this file).
- **A safety net for the AI pipeline**: unit tests over the deterministic
  time parsing (`npm test`), a live smoke-test script
  (`scripts/smoke-test.ps1`) that exercises the deployed parser with a
  throwaway account, a daily `ai-canary` cron that push-notifies the owner
  if the whole Gemini model chain fails, and CI deploys of the edge
  functions so deployed code can't drift from the repo.

### Changed
- **Week grid edits now ask before saving.** Tapping a cell stages the
  change (dashed outline) instead of writing it immediately; a floating bar
  shows how many changes are pending, with Save and Cancel buttons. Taps
  still cycle blank → done → skipped, and cycling back to the saved state
  drops the draft.
- **Every emoji in the UI replaced with a hand-rolled inline SVG icon set** —
  identical rendering on every device, theme-aware colors.
- Card actions (Pause/Edit/Activate on week cards, the plan card's Edit, the
  cardio base row) are proper themed pill buttons instead of bare text.
- The cardio "easy-week base" is edited behind an explicit Edit → Save/Cancel
  flow; it no longer writes to the database on blur.
- The cardio week chart no longer draws a ghost outline on an empty "today".
- Empty days on the cardio week chart show the same small accent dash the
  Explore chart uses at zero, so a quiet day reads as "nothing logged" rather
  than a gap in the chart.
- Composer placeholder is a general "What's up today?" with varied examples.
- README screenshots retaken with the current design.

### Fixed
- Reminder add row no longer crushes the text field on phones; date/time
  pickers are always visible with "due"/"at" labels.
- The parser survives weak models: duplicate actions are dropped, the action
  list is capped, truncated JSON falls through to the next model, and a
  retired model name (404) no longer aborts the whole chain.
- Done/Dismiss buttons on the Reminders screen render as buttons again.
