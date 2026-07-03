# Routine Tracker

An AuDHD-friendly routine tracker I built for myself. You just type (or say)
*"took my meds and drank water"* and it ticks the right boxes for you.
Self-hosted and free to run, no subscription.

## Why I built this

I was managing my routines with Google Docs, and honestly it was painful. It
was unresponsive on my phone, and every small update meant scrolling around a
big table hunting for the right cell. That is way too much work for just being
spontaneous, and it demands exactly the kind of focused effort that routines
are supposed to remove from your day.

The apps made for this are mostly behind a paywall. The good ADHD planners
charge around [$3 to $12 per month](https://habi.app/insights/best-adhd-planner-apps/),
and the free tiers [keep shrinking](https://mutra.app/resources/best/best-free-adhd-planner-apps/)
as features quietly move behind the subscription. Paying a monthly fee to
manage a condition that already costs you money (people call it the
["ADHD tax"](https://affine.pro/blog/best-adhd-planner-apps)) didn't sit right
with me.

By the way, the research agrees with both complaints. If a tracker takes too
long to set up or use, ADHD brains
[abandon it before it delivers any value](https://kabitapp.com/blog/habit-tracker-adhd),
and the feature-heavy ones turn into
["productive procrastination"](https://www.mindfulsuite.com/reviews/best-habit-tracker-apps),
you spend 20 minutes looking at completion charts instead of doing the habits.
The best tracker is
[the one that takes less time to use than the habit itself](https://routinebase.com/best-habit-tracker-apps/).

So the whole idea here is one text box. You write what you did in plain words
and the AI files it. No hunting through lists, no forms, no fee.

## What it does

- **Conversational check-off.** One message box handles everything. *"did
  morning routine except shower"* checks off the whole routine and marks the
  shower as skipped. *"bench 60kg 3x8, felt easy"* goes into the workout
  logbook. *"remind me to email the lawyer"* becomes a categorized reminder,
  and *"low energy today"* switches the whole day to minimum mode. Voice input
  works too.
- **Energy-aware routines.** Tasks have tiers (core / standard / bonus). On a
  low-energy day you only see the core minimum, and completing that still
  counts as a full win.
- **No streaks, no shame.** Skips show up neutral, blanks stay blank, and the
  weekly view shows patterns instead of pass/fail.
- **The AI is careful.** Confident actions apply instantly with a one-tap
  undo, uncertain ones come back as "Did you mean...?" chips, and every AI
  action is logged and reversible. Nothing happens silently.
- **Workout logbook.** Sets, weights, reps and notes, parsed from plain text.
- **Fully editable.** Add, rename and delete routines and tasks, set each
  task's tier and which weekdays it appears.
- **Installable PWA.** Works as a home-screen app, messages you write offline
  are queued and sent when you're back online, and everything syncs across
  devices in realtime.

## Design

The UI follows its own bedtime advice (dim lights, no screens): a warm,
low-blue "lamplight" palette, one amber accent, sage green for done. The body
font is Atkinson Hyperlegible, which was designed by the Braille Institute for
maximum legibility. There is no red X anywhere in the app!

## Stack

React + Vite + TypeScript · Supabase (Postgres, Auth, Realtime, Edge Functions) ·
Gemini Flash-Lite · GitHub Pages · PWA

Running cost is effectively zero. The Supabase and Gemini free tiers cover
personal use, and even on paid pricing, ~100 AI messages a day would cost well
under $1/month.

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

Mind that you should keep the Gemini project unbilled to stay on the free tier.

### 3. Local dev

```sh
cp .env.example .env    # fill in from Supabase Settings > API
npm install
npm run dev
```

On your first sign-in the app seeds a starter set of routines
(`src/lib/seedData.ts`, you can edit them there or in the app).

### 4. Deploy (GitHub Pages)

1. Create a GitHub repo and push.
2. Repo **Settings > Pages**: set Source to "GitHub Actions".
3. Repo **Settings > Secrets and variables > Actions**: add `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_API_KEY` as repository secrets (just the values, nothing else!).
4. Push to `main` and `.github/workflows/deploy.yml` builds and publishes it.
5. Supabase **Authentication > URL Configuration**: add your Pages URL
   (`https://<user>.github.io/<repo>/`) as a redirect URL.

Also, once your own account exists, I recommend turning off "Allow new users
to sign up" in the Supabase Auth settings, so strangers can't use your AI quota.

## How the AI input works

The `interpret-message` Edge Function receives your text plus today's date and
weekday, loads today's scheduled tasks, and asks Gemini for a structured list
of actions (check-offs, workout sets, reminders, energy level). Actions with
confidence ≥ 0.9 are applied immediately (still undoable, every batch is
recorded in `ai_actions`), the 0.6–0.9 ones come back as one-tap confirm
chips, and below that nothing happens at all. The day's tasks are injected
straight into the prompt as candidates, which at personal scale works better
than embeddings and costs basically nothing.
