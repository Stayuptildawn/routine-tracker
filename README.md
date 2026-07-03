# Routine Tracker

AuDHD-friendly routine tracker with conversational check-off. Type (or speak)
*"took my meds and drank water"* and the right boxes get ticked.

## Stack

React + Vite + TypeScript · Supabase (Postgres, Auth, Realtime, Edge Functions) ·
Gemini 2.5 Flash-Lite · GitHub Pages · PWA

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

On first sign-in the app seeds your routines from the spreadsheet data
(`src/lib/seedData.ts` — edit tiers/days there or in the app).

### 4. Deploy (GitHub Pages)

1. Create a GitHub repo and push.
2. Repo **Settings > Pages**: set Source to "GitHub Actions".
3. Repo **Settings > Secrets and variables > Actions**: add `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_API_KEY`.
4. Push to `main` — `.github/workflows/deploy.yml` builds and publishes.
5. Supabase **Authentication > URL Configuration**: add your Pages URL
   (`https://<user>.github.io/<repo>/`) as a redirect URL.

## How the AI input works

`supabase/functions/interpret-message` receives your text plus today's date/weekday,
loads today's scheduled tasks, and asks Gemini for a structured actions array
(check-offs, workout sets, reminders, energy level). Actions with confidence ≥ 0.9
are applied immediately (undoable — every batch is recorded in `ai_actions`);
0.6–0.9 come back as one-tap confirm chips; below that, nothing happens silently.

## Design principles

No streaks. Blanks are neutral, skips are deliberate and guilt-free. A daily
energy check-in (low/medium/high) filters tasks by tier, so a low-energy day
shows only the core minimum — and completing it counts.
