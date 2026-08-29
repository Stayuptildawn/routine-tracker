# UX Audit — first-time-user experience

App: a routine + hybrid-training tracker PWA (React 19 / Vite / Supabase) for one person
managing daily routines, 6-week gym blocks, cardio and AI-assisted logging.

Method: Pass 1 walked the running app (dev server, demo mode = the real first-time
funnel) at the mobile layout (<900px breakpoint; Chrome window floor is 500px, so
375px-specific claims were verified by measuring rendered elements and the CSS) and at
1440px desktop. Pass 2 located each issue in code. Element sizes below are measured from
the live DOM, not estimated.

Core flows a new user attempts first:
1. **Land on Auth → try the demo or create an account** — the entire funnel starts here.
2. **Now tab: check off routine tasks / talk to the composer** — the first minute of value.
3. **Week tab: read and fix the weekly record** — the record is the product's promise.
4. **Workout: set up training → start a block → log a first session** — the deepest flow.
5. **Reflect: read the weekly reflection, explore data** — the payoff loop.

Spacing scale referenced throughout: the existing `--sp-1..7` tokens and `rem` units in
`src/index.css` (the codebase's single scale). No new patterns or libraries introduced.

---

## Issues

### 1. Demo badge floats over interactive content
- **Issue:** `.demo-badge` is `position: fixed` bottom-center on mobile, permanently
  covering the last visible row of every screen — task Done/Skip buttons, the reminders
  "Open →" link, chart labels. Demo users *are* the first-time users; their first session
  has a bar sitting on top of tappable rows the whole time.
- **Location:** `src/index.css` `.demo-badge` (fixed positioning), rendered in `src/App.tsx`.
- **Device:** both (mobile is the harmful case).
- **Severity:** Major
- **Fix:** Make the badge a static in-flow row at the top of the app: remove
  `position: fixed / bottom / left / transform / z-index`, give it
  `margin: var(--sp-3) auto 0` and `width: fit-content`, and delete the ≥900px override.
  It then pushes content down instead of covering it, on both layouts.

### 2. Week grid cells are 27×29px tap targets
- **Issue:** The tappable day cells — the *primary* interaction of the Week tab — measure
  27×29px with ~2px between columns. Thumb-sized taps routinely land on the wrong day;
  first-time users conclude the grid is broken or read-only.
- **Location:** `src/index.css` `.week-grid` cell rules; `src/screens/Week.tsx`.
- **Device:** mobile (desktop cells are equally small but mouse-precise).
- **Severity:** Major
- **Fix:** Grow `.week-grid .cell` to `2.25rem × 2.25rem` (base and ≤600px override) and
  shrink `.task-name`'s mobile cap from `28vw` to `22vw` so seven thumb-sized cells still
  fit at 375px without sideways scrolling — the existing "name gives way, never the days"
  rule, kept. The wrap's `overflow-x: auto` stays as the safety net for tiny phones.

### 3. Flexible-session composer is always fully expanded
- **Issue:** On the Workout tab, the flex card permanently shows its subtitle, two pill
  rows, a full-width Generate button, a divider and the 0–6 day picker — a full screen of
  secondary controls wedged between the block grid (the primary action) and the coach's
  note/plan. A new user mid-setup scrolls through a tool they don't need yet.
- **Location:** `src/screens/Gym.tsx` flex card section.
- **Device:** both.
- **Severity:** Major
- **Fix:** Progressive disclosure using the card's existing `training-history` link
  pattern: collapsed state shows the h2, open/past session rows and a single
  `link`-styled opener (reusing `t.gym.flex.generate`); tapping it reveals the composer
  (pills, generate, week layout). No new strings, no new patterns.

### 4. Several controls are far below the 44px touch floor
- **Issue:** Measured on the mobile layout: routine-card `Start` 68×27px, composer mic
  (`.voice`) 68×31px, Now-header settings gear (`.settings-inline`) 32×32px. These are
  frequently-used controls; 27px is genuinely hard to hit.
- **Location:** `src/index.css` `.start-btn`, `.voice`, `.settings-inline`.
- **Device:** mobile.
- **Severity:** Major
- **Fix:** `min-height: 2.75rem` (44px at default zoom, scales with font size) on
  `.start-btn` and `.voice`; `.settings-inline` gets `min-width: 2.75rem;
  min-height: 2.75rem` with its existing padding centered via inline-flex.

### 5. Sign-up can dead-end silently
- **Issue:** In `Auth.tsx`, `signUp` success with email confirmation enabled returns no
  session and no error — the form just sits there, unchanged. A new user's very first
  action in the product ends in silence.
- **Location:** `src/screens/Auth.tsx` `submit()`.
- **Device:** both.
- **Severity:** Major
- **Fix:** When `signUp` returns no error and no session, show a notice ("Account
  created — check your email to confirm, then sign in.") via a new `t.auth.confirmSent`
  string (added to all 11 language packs). If confirmations are off, a session comes back
  and the notice never renders — safe either way.

### 6. Nothing says the Week grid is editable
- **Issue:** Cells cycle done → skipped → blank on tap, but the only affordance is a
  hover-only `title` attribute — invisible on touch. The subtitle ("A record, not a
  scorecard…") doesn't mention interaction. First-time users don't discover the tab's
  main capability.
- **Location:** `src/screens/Week.tsx` subtitle; `src/i18n/*.ts` `week.subtitle`.
- **Device:** both (mobile worse).
- **Severity:** Major
- **Fix:** Extend `week.subtitle` in every pack with one sentence: "Tap any past day to
  cycle done / skipped / blank."

### 7. Session logging: grey numbers look prefilled, and nothing explains the tick
- **Issue:** Set rows show last time's weight × reps as grey *placeholders*; ticking ✓
  logs those numbers unless the user types others. That's a good fast path — but nothing
  says so. A first-timer hesitates: "is this already filled? do I retype everything?"
- **Location:** `src/screens/Session.tsx`; `src/i18n/*.ts` `session`.
- **Device:** both.
- **Severity:** Minor
- **Fix:** One `gentle` hint line under the date, shown only while nothing is logged
  yet: new `t.session.placeholderHint` ("Tick ✓ to log the grey numbers from last time —
  or type your own first.") in all 11 packs.

### 8. Explore frame pills are bare letters with hover-only meaning
- **Issue:** "D W M 6M Y" carry their explanation (`frames[f].hint`) only after
  selection, in the header; the buttons themselves have no `title`/`aria-label`. On
  touch there is no hover, so a new user taps blind.
- **Location:** `src/screens/Reflect.tsx` frame buttons.
- **Device:** mobile primarily; also AT users on desktop.
- **Severity:** Minor
- **Fix:** Add `title={t.reflect.frames[f]?.hint}` and
  `aria-label={t.reflect.frames[f]?.hint}` to each frame button. Strings already exist.

### 9. Session weight/reps inputs are unlabeled for assistive tech
- **Issue:** The kg and reps number inputs rely on placeholders alone; a screen reader
  announces two anonymous spinbuttons per set.
- **Location:** `src/screens/Session.tsx` set-row inputs.
- **Device:** both.
- **Severity:** Minor
- **Fix:** `aria-label={t.session.kgPh}` / `aria-label={t.session.repsPh}` on the two
  inputs. Strings already exist.

### 10. Settings is unreachable from four of five tabs on mobile
- **Issue:** On mobile, the settings gear lives only in the Now tab header
  (`.settings-rail` is `display: none` under 900px). From Week/Workout/AI Log/Reflect a
  new user hunting for language, theme or sign-out finds nothing and must rediscover the
  gear back on Now.
- **Location:** `src/index.css` `.settings-rail`; the button already exists in the
  tab bar markup (`src/App.tsx`).
- **Device:** mobile.
- **Severity:** Major
- **Fix:** Under 900px, show `.settings-rail` as a compact icon-first tab-bar item
  (same column layout as `.tab`, `font-size: var(--fs-xs)`, `padding: var(--sp-2)`),
  and hide the redundant Now-header gear. One consistent location on every tab.

### 11. On narrow phones the Week grid opens scrolled away from today
- **Issue:** The grid is ~427px wide; at 375px it scrolls horizontally starting at
  Monday. From Friday onward, *today* — the column users came to tick — starts
  off-screen with no cue.
- **Location:** `src/screens/Week.tsx` (`.week-grid-wrap`).
- **Device:** mobile ≤ ~430px.
- **Severity:** Minor
- **Fix:** On first render, scroll the wrap so today's column is visible:
  a `ref` effect calling `wrap.scrollLeft = wrap.scrollWidth` when today is Fri–Sun
  (grid direction-safe, no smooth-scroll needed).

### 12. Auth success and error messages look identical
- **Issue:** "Check your email for a reset link" (good news) and "Invalid login
  credentials" (failure) render in the same `.notice` box; a stressed first-time user
  scans color before words.
- **Location:** `src/screens/Auth.tsx`; `src/index.css` `.notice`.
- **Device:** both.
- **Severity:** Minor
- **Fix:** Add a `.notice.good` variant (`background: var(--good-soft);
  border-color: var(--good); color: var(--text)`) and apply it to the reset-sent (and
  new confirm-sent) notices.

---

## Top 5 by impact-to-effort

1. **#1 Demo badge overlap** — a few CSS lines; removes a permanent obstruction from the
   entire first-time funnel.
2. **#2 Week grid tap targets** — small CSS; makes the Week tab's core interaction
   physically usable on phones.
3. **#4 Sub-44px controls** — three selectors; fixes the most-tapped small buttons.
4. **#10 Settings in the mobile tab bar** — CSS-only; ends the "where are settings?"
   hunt on four tabs.
5. **#6 Week tap hint** — one sentence per language; turns a hidden capability into a
   discovered one.
