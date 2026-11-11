# ESL Listening Studio

Teachers of English as a second language write a conversation, pick a speaker, emotion and
speed for each line, and turn it into audio for listening practice or tests.

Live: https://audio-text-esl.vercel.app

## Features

- Email/password sign-in (Neon Managed Better Auth), limited to the emails in `ALLOWED_EMAILS`.
- A one-time tutorial; every new teacher gets Dad/Mom/Son/Daughter characters and a 16-line
  "Family dinner" template.
- **Characters** with voice service, voice, gender, age, accent and default speed. Editing a
  character creates a new version; history shows what changed since older audio was made.
- **Editor** with speaker, emotion (fixed list) and speed per line, and an adjustable pause.
  Edits are saved to IndexedDB first, queued for the server (survives reloads and offline
  periods) and synced across devices with Neon Realtime (polling fallback).
- **Convert to audio**: each conversion is an immutable version (v1, v2…). Lines are cached by
  everything that affects the sound, so unchanged lines are reused for free.
- Player with synced transcript highlighting and in-browser background noise (not baked into
  the MP3). Download the full MP3 or single lines.
- Revocable public share links per version, optionally hiding the transcript.
- Script PDF and gap-fill worksheet PDF with an answer key.
- Costs and the shared budget shown in Thai baht (`USD_THB_RATE`, default 33.5).

## Voices

- **Supertonic 3** (free): runs on the server with ONNX Runtime. Model files (~398 MB, pinned
  revision of `Supertone/supertonic-3`) download to `/tmp` on a cold start.
- **OpenRouter**: every speech model estimated under `MAX_TEMPLATE_USD` (default $0.05) for
  the template conversation. Real cost per line comes from OpenRouter's generation stats.
  Emotions are passed only to models that support them; speed uses the model's own control
  or a pitch-preserving tempo filter.

## Stack

Next.js 16 (App Router) on Vercel, Neon (Postgres + Managed Better Auth + Object Storage +
Realtime), Drizzle ORM over Neon's HTTPS driver, ffmpeg-static, onnxruntime-node, jsPDF.

## Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon Postgres |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Managed Better Auth |
| `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET` | Realtime live queries |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | Neon Object Storage |
| `OPENROUTER_API_KEY` | Inference key (has a spending cap; its remaining cap is the shared budget) |
| `OPENROUTER_MANAGEMENT_KEY` | Optional: also shows the account-wide balance |
| `ALLOWED_EMAILS` | Comma-separated; change and redeploy to add teachers |
| `USD_THB_RATE` | THB per USD |
| `WORKER_SECRET` | Signs internal worker calls |

## Development

```bash
npm install
npm run dev
```

`npx tsx scripts/migrate.mts` applies `drizzle/` migrations. Inside the Claude cloud sandbox
use `scripts/dev-sandbox.sh`, which drops the sandbox's own `DATABASE_URL`/`AWS_*` variables.
