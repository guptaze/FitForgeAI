# FitForge AI — PRD (Iteration 2)

## Overview
FitForge AI is a personalised strength + fat-loss plan generator on React Native (Expo SDK 54, iOS-first) with dense dark UI. It combines:
1. Claude Sonnet 4.6 plan generation with target header, day-focused workouts, meal alternates, and bloodwork-aware supplements
2. Voice morning check-in (weight / bowel / sleep quality)
3. Voice + photo food logging via Claude Vision & OpenAI Whisper
4. Apple HealthKit dashboard (MOCKED in Expo Go)
5. Bloodwork upload (image OR PDF) → tailored supplement + lifestyle guidance
6. Per-exercise workout logging (compliance tracking)

## Architecture
- **Frontend**: Expo SDK 54, expo-router. Tabs `Home | Plan | [+FAB] | Blood` with quick-log modal at `/quick-log`.
- **Backend**: FastAPI + MongoDB (`plans`, `checkins`, `food_logs`, `health_samples`, `workout_logs`, `bloodwork`).
- **AI**:
  - Claude Sonnet 4.6 (`claude-sonnet-4-6`) via user-provided Anthropic key → plan gen, morning check-in parsing, food voice/photo analysis, bloodwork report analysis.
  - OpenAI Whisper (`whisper-1`) via Emergent LLM key → audio transcription.
- **PDF**: `pypdf` extracts text server-side before sending to Claude.

## Screens
1. **Home (Overview)** — weight vs target with progress, calories today vs target + yesterday, morning check-in tiles, Apple Health mock tiles, today's food log.
2. **Plan** — Target header (Start → Goal → Duration → Rate), Today's Workout with per-exercise cards (colored gradient thumbnails by muscle group + DEMO opens YouTube search + LOG opens set/reps/weight modal), day switcher for other training days. Collapsibles: Meal Plan (per-meal alternates with macros), Supplements (banner switches between GENERIC and TAILORED based on bloodwork; gates bloodwork-dependent supplements), Blood Panel, Monthly Progression, Rate Validation, Injury Risk, Recovery, Summary. Edit button returns to form.
3. **Blood** — Empty state until upload. Upload via Camera, Gallery, or PDF. Once analyzed: summary, markers table with high/low/normal flags, abnormal findings with clinical significance, tailored supplement plan (dose + rationale + marker), lifestyle / dietary recommendations, doctor flags. Retest reminder.
4. **Quick Log modal** (from central FAB) — Morning check-in / Food voice / Food camera / Food gallery.

## New API Surface (iteration 2)
- `GET /api/overview` — home dashboard aggregate
- `POST /api/workouts/log` — per-exercise completed workout
- `GET /api/workouts/today` · `GET /api/workouts/history` · `DELETE /api/workouts/{id}`
- `POST /api/bloodwork/upload-image` (JSON base64) → Claude Vision extract + advice
- `POST /api/bloodwork/upload-pdf` (multipart) → pypdf → Claude
- `GET /api/bloodwork/latest` · `DELETE /api/bloodwork/{id}`

## Plan JSON schema additions
- `targets: { start_weight_kg, target_weight_kg, duration_months, weekly_rate_kg }`
- `training_split.table[].exercises[].demo_query` (YouTube search) and `.muscle_group`
- `meal_plan: [ { meal, time_window, target_calories, target_protein_g, options: [...] } ]` — exactly 2 options per meal
- `supplement_stack[].requires_bloodwork` (bool) + `.target_marker` — supplements gated until bloodwork is uploaded

## Important notes
- **HealthKit remains MOCKED** in Expo Go / web preview — real data requires a native iOS build.
- **Plan generation takes ~60-90s** (Claude Sonnet 4.6 with `max_tokens=12000`). Public URL may 502 at ~60s — frontend automatically polls `/api/plan/latest` for up to 90s and swaps in the plan once persisted. Backend always finishes.
- **Bloodwork image analysis** gracefully returns an empty-markers response (with a friendly `overall_summary`) if the report is unreadable; same for food photos.

## No auth (MVP)
Single-user MongoDB namespace. Auth can be added later.
