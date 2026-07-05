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

The other half of it was that my life was scattered across a pile of apps and
tabs. Routines in one, workout notes in another, reminders somewhere else, and
I was the one stuck keeping them all in sync. I wanted a single place that just
held everything I needed, so checking in on my day was one seamless move
instead of a scavenger hunt across five apps.

And honestly, I don't think you need an AuDHD brain to get something out of
this. I built it around mine, but everyone has days where a list feels like too
much, or where typing *"went for a run"* beats tapping through a bunch of
menus. If the friction of just keeping up with your own life bothers you at
all, this was made to take that friction away, and that is not a
neurodivergent-only problem.

I built it around my own brain first, but I'm nowhere near done with it. I'm
actively expanding it, and I'd like it to fit more people than just me. So if
you've got an idea, I'm honestly happy to hear it, and if the project is useful
to you and you want to help keep it going, both suggestions and donations are
welcome.

## What it does

**One message box, reachable from anywhere.**

- *"did morning routine except shower"* checks off the whole routine and marks
  the shower as skipped. *"remind me to email the lawyer by Friday"* becomes a
  categorized reminder with a due date. *"low energy today"* switches the whole
  day to minimum mode. Voice input works too.
- It answers questions without writing anything: *"when did I last refill?"*,
  *"what did I bench last time?"*.
- The same brain is reachable from a **Telegram bot** (text it from anywhere,
  it replies with what it did) and from Android's **share sheet** (share text
  into the app, it lands in the message box for review).
- The AI is careful. Confident actions apply instantly with one-tap undo,
  uncertain ones come back as "Did you mean...?" chips, every action batch is
  logged and reversible, and the log shows a running accuracy score. Nothing
  happens silently.

**Routines that adapt to the day.**

- Tasks have tiers (core / standard / bonus). On a low-energy day you only see
  the core minimum, and completing that still counts as a full win.
- Routines can have a time anchor ("around 8:00"). Near their time they float
  to the top with a little countdown ring — a time-blindness aid, not an alarm.
- A **routine player**: one task at a time, full screen, two big buttons, for
  the days when a list is already too much. An always-on **"Up next" strip**
  picks the single most sensible pending task (instantly, no AI call) — tap
  it and the player opens right there.
- Routines can be **paused** from the week view: hidden from the day, the AI
  and the nudges, history intact, one tap to bring back.
- Optional **push nudges**: if a routine's anchor passes and its core tasks are
  still pending, you get one gentle notification ("Morning routine is ready
  when you are") — at most once per routine per day, and never "you missed".
- No streaks, no shame. Skips show up neutral, blanks stay blank, past days can
  be corrected from the week grid, and taps work offline (they queue and sync).

**A full training module.**

- Your program lives as **training blocks** (6-week PPL then Upper/Lower,
  rep-wave periodization, an injury-safe execution cue on every exercise).
  One tap generates all sessions and sets for a block.
- The **session player** shows every exercise with its sets, last time's
  numbers pre-filled as placeholders (double progression made easy), and the
  safety cue pinned under the name. *"leg press 120 4x8"* typed anywhere fills
  those exact planned sets.
- After a session, an optional **recovery check-in** per muscle (how it
  recovered, how hard it worked, how the amount felt) — and if a muscle says
  "over the line" twice, you get a dismissible suggestion, never a silent plan
  edit.
- A **volume picture** (hard sets per muscle per week) and a **cardio view**
  with quick logging, weekly distance, and pace — runs, walks, cycles, swims.

**Reflection, gently.**

- Weekly bars count everything you did — tasks, gym sessions, cardio — with
  patterns instead of pass/fail.
- An **Explore chart**: tasks, hard sets or cardio km over the last 24 hours
  (hourly), 7 days, 32 days, 6 months or 12 months, with min/max/avg.
- Every Sunday evening the AI writes two sentences about your week: one
  pattern it noticed, one permission-based suggestion. Words like "failed" and
  "missed" are banned at the prompt level and checked again after.
- Your data is yours: one-tap CSV export of tasks, workouts, training sets,
  cardio, recovery check-ins and reminders.

**And the basics done right.** Installable PWA, realtime sync across devices,
offline queues for messages, taps and gym logging, a settings screen with
theme (auto/light/dark) and per-user timezone, fully editable routines,
tasks and training plans.

## Design

The UI follows its own bedtime advice (dim lights, no screens): a warm,
low-blue "lamplight" palette, one amber accent, sage green for done. The body
font is Atkinson Hyperlegible, which was designed by the Braille Institute for
maximum legibility. There is no red X anywhere in the app!

## Stack

React + Vite + TypeScript · Supabase (Postgres, Auth, Realtime, Edge
Functions, pg_cron) · Gemini Flash-Lite · GitHub Pages · Web Push · PWA

No chart libraries, no drag-and-drop libraries, no CSS framework — the bars
are divs and the design system is one CSS file.

## How many users can this handle?

Honestly: it's built for **one** — me — though the sharpest single-user edges
have been filed off (each user picks their own timezone in Settings, the
starter routines and workout plan are opt-in templates now). The main
remaining assumption is the Telegram bot, which links to a single account.
Signups are meant to be disabled after you create your account.

That said, since people ask, here's where the free-tier ceilings actually
are, in the order they'd break:

1. **Gemini (unbilled): the real limit.** Roughly 15 requests/minute and
   ~1,000–1,500/day on the free tier. Every message, question and "what's
   next?" is one request (a 3-model fallback chain stretches this a bit). At
   20–30 messages per user per day, that's **~30–50 active users** before
   midday rate-limit errors — and one user never gets close.
2. **Supabase Realtime: 200 concurrent connections.** An open app holds one
   or two, so about **100–150 simultaneously open apps**.
3. **Everything else is far away.** Edge Functions allow 500K
   invocations/month (the nudge cron uses ~3K), the 500MB database is years
   of personal data (a whole 6-week training block is ~700 tiny rows), and
   GitHub Pages barely notices a 450KB app.

If you enabled Gemini billing, the AI cost is ~$0.0002 per message (~100
messages a day is well under $1/month), and the ceiling moves to Realtime
connections. But making it genuinely multi-user would also need real work:
per-user timezones, per-user Telegram links, onboarding instead of my seed
routines. For its actual job — one person, zero dollars — the headroom is
enormous.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in `supabase/migrations/` **in order** (0001 → 0010) in
   the SQL editor, or `supabase db push` with the CLI. Heads-up: the editor
   runs each paste as one transaction, so run them one file at a time.
3. In **Authentication > Providers**, enable Email. Disable "Confirm email"
   if you want instant single-user signup.

### 2. Edge Functions

```sh
npm i -g supabase
supabase login
supabase secrets set GEMINI_API_KEY=<your-gemini-api-key>   # aistudio.google.com/apikey
supabase functions deploy interpret-message --project-ref <ref>
```

Mind that you should keep the Gemini project unbilled to stay on the free
tier. The functions share code from `supabase/functions/_shared/`, which the
CLI uploads automatically (the dashboard paste-editor can't).

**Optional extras**, each independent:

- **Telegram bot**: create a bot with @BotFather, set secrets
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_LINK_CODE`,
  `USER_TIMEZONE` (IANA name), deploy `telegram-webhook` with
  `--no-verify-jwt`, register the webhook with `secret_token`, then DM the
  bot `/link <your-code>`.
- **Weekly AI reflection**: set a `CRON_SECRET` secret, deploy
  `weekly-reflection` with `--no-verify-jwt`, enable the `pg_cron` and
  `pg_net` extensions, and schedule a Sunday-evening `net.http_post` to it
  with an `x-cron-secret` header.
- **Push nudges**: generate keys with `npx web-push generate-vapid-keys`, set
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a mailto:) and
  `CRON_SECRET` secrets, add the public key as a `VITE_VAPID_PUBLIC_KEY`
  repo secret, deploy `send-nudges` with `--no-verify-jwt`, and schedule it
  every 15 minutes like the reflection. iOS needs the PWA installed to the
  home screen.

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
3. Repo **Settings > Secrets and variables > Actions**: add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_API_KEY` as repository secrets
   (just the values, nothing else!).
4. Push to `main` and `.github/workflows/deploy.yml` builds and publishes it
   (it even retries the flaky Pages deploy step once for you).
5. Supabase **Authentication > URL Configuration**: add your Pages URL
   (`https://<user>.github.io/<repo>/`) as a redirect URL.

Also, once your own account exists, I recommend turning off "Allow new users
to sign up" in the Supabase Auth settings, so strangers can't use your AI
quota.

## How the AI input works

The interpret core (`supabase/functions/_shared/interpret.ts`, shared by the
app's `interpret-message` and the Telegram webhook) receives your text plus
today's date and weekday, loads today's scheduled tasks, and asks Gemini for
a structured list of actions: check-offs, workout sets, cardio, reminders
(with due dates), energy level, or read-only questions. Actions with
confidence ≥ 0.9 are applied immediately (still undoable, every batch is
recorded in `ai_actions`), the 0.6–0.9 ones come back as one-tap confirm
chips, and below that nothing happens at all. If a planned training session
is open today, logged sets fill the session's planned sets instead of the
freeform log — so the composer, the Telegram bot and the session player all
write the same rows. The day's tasks are injected straight into the prompt as
candidates, which at personal scale works better than embeddings and costs
basically nothing.
