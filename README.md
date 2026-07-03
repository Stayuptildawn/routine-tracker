# Routine Tracker

An AuDHD-friendly routine tracker with conversational check-off. Type (or speak)
*"took my meds and drank water"* and the right boxes get ticked. Self-hosted,
free to run, no subscription.

## Why this exists

I built this because the alternatives kept failing me in two opposite ways:

- **The good apps are paywalled.** Nearly every ADHD-friendly planner locks its
  useful features behind a subscription — typically [$3–12/month](https://habi.app/insights/best-adhd-planner-apps/),
  with free tiers that [shrink over time](https://mutra.app/resources/best/best-free-adhd-planner-apps/)
  as features migrate behind the paywall. Paying a recurring fee to manage a
  condition that already costs you money is the
  ["ADHD tax"](https://affine.pro/blog/best-adhd-planner-apps) on top of the ADHD tax.
- **The free tool was a spreadsheet.** I ran my routines from Google Docs. It
  was unresponsive on a phone, and updating it demanded exactly the kind of
  deliberate, structured effort that routines are supposed to *remove*. Nothing
  about a spreadsheet works when you just want to be spontaneous — you're
  scrolling, zooming, and hunting cells at the moment your executive function
  is at its lowest.

The research on abandoned trackers says the same thing from both directions:
[if setup or daily use takes too long, ADHD brains abandon the tool before it
delivers any value](https://kabitapp.com/blog/habit-tracker-adhd), and
feature-rich dashboards become
["productive procrastination" — analyzing completion trends instead of doing the habits](https://www.mindfulsuite.com/reviews/best-habit-tracker-apps).
The best tracker is [the one that takes less time to use than the habit takes to do](https://routinebase.com/best-habit-tracker-apps/).

So the design goal here is a single text box: say what you did in plain words,
and the AI files it. No hunting through lists, no forms, no fee.

## What it does

- **Conversational check-off** — one message box handles everything:
  *"did morning routine except shower"* checks off the routine and marks the
  shower skipped; *"bench 60kg 3x8, felt easy"* logs a workout;
  *"remind me to email the lawyer"* files a categorized reminder;
  *"low energy today"* switches the whole day to minimum mode. Voice input included.
- **Energy-aware routines** — tasks have tiers (core / standard / bonus). A
  low-energy day shows only the core minimum, and completing it still counts.
- **No streaks, no shame** — skips render neutral, blanks stay blank, and a
  weekly reflection view shows patterns instead of pass/fail.
- **Trust rails for the AI** — confident actions apply instantly with one-tap
  undo; uncertain ones become "Did you mean…?" chips; every AI action is
  auditable and reversible in a history log.
- **Workout logbook** — sets, weights, reps, and notes, parsed from plain text.
- **Fully editable** — add, rename, and delete routines and tasks; set each
  task's tier and scheduled weekdays.
- **Installable PWA** — home-screen app with offline capture (messages queue
  and send when you're back online), synced across devices in realtime.

## Design

The UI follows its own bedtime advice — *dim lights, no screens*: a warm,
low-blue "lamplight" palette, one amber accent, sage for done. Type is
Atkinson Hyperlegible (designed by the Braille Institute for legibility) with
Bitter for headings. No red X anywhere. Calm skeletons, visible keyboard
focus, `prefers-reduced-motion` respected.

## Stack

React + Vite + TypeScript · Supabase (Postgres, Auth, Realtime, Edge Functions) ·
Gemini Flash-Lite · GitHub Pages · PWA

Running cost: effectively zero. Supabase free tier + Gemini free tier cover
personal use; even paid, ~100 AI messages/day costs well under $1/month.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push` with the CLI).
3. In **Authentication > Providers**, enable Email. Disable "Confirm email" if you
   want instant single-user signup.

### 2. Edge Function

```sh
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set GEMINI_API_KEY=<your-gemini-api-key>   # aistudio.google.com/apikey
supabase functions deploy interpret-message
```

Keep the Gemini project unbilled to stay on the free tier.

### 3. Local dev

```sh
cp .env.example .env    # fill in from Supabase Settings > API
npm install
npm run dev
```

On first sign-in the app seeds a starter set of routines
(`src/lib/seedData.ts` — edit them there or in the app).

### 4. Deploy (GitHub Pages)

1. Create a GitHub repo and push.
2. Repo **Settings > Pages**: set Source to "GitHub Actions".
3. Repo **Settings > Secrets and variables > Actions**: add `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_API_KEY` as repository secrets.
4. Push to `main` — `.github/workflows/deploy.yml` builds and publishes.
5. Supabase **Authentication > URL Configuration**: add your Pages URL
   (`https://<user>.github.io/<repo>/`) as a redirect URL.

## How the AI input works

`supabase/functions/interpret-message` receives your text plus today's date/weekday,
loads today's scheduled tasks, and asks Gemini for a structured actions array
(check-offs, workout sets, reminders, energy level). Actions with confidence ≥ 0.9
are applied immediately (undoable — every batch is recorded in `ai_actions`);
0.6–0.9 come back as one-tap confirm chips; below that, nothing happens silently.
Task candidates are injected straight into the prompt — at personal scale that
beats embeddings for both accuracy and cost.
