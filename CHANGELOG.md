# Changelog

User-visible changes, newest first. Dates are the day they reached the
deployed app (push to `main` deploys the frontend; edge functions are
deployed alongside).

## 2026-07-12

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
