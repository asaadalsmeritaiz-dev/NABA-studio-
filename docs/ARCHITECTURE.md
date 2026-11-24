# Naba AI Video Studio — Architecture, Security, Providers & Deployment Guide

## 1. System Overview & Module Boundaries

**Naba AI Video Studio** is an Arabic-first (RTL) and English (LTR) educational video production platform built as an independent module for the **Naba Academy** ecosystem.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Frontend SPA (React 19 + TypeScript + Tailwind CSS v4 + RTL/LTR i18n)     │
│  • AuthGate (Claim / Sign In / Register)   • ErrorBoundary Recovery       │
│  • ProjectsDashboard   • 10-Step CreationWizard   • Multi-Track Editor    │
│  • LecturersLibrary    • ExportCenter & Verified Academy Publish Bridge   │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Bearer Auth + Scoped Media Tokens (/api/*)
┌───────────────────────────────▼───────────────────────────────────────────┐
│ Express API & Orchestration Backend (server.ts + server/app.ts)           │
│  • Server-Side Session Auth & Ownership Isolation (server/services/auth)  │
│  • Zod Request Validation     • Sliding-Window Rate Limiting              │
│  • Multer + Magic-Byte Guards • Path Confinement & External URL Guards    │
├───────────────────────────────┬───────────────────────────────────────────┤
│ Relational Database (SQLite)  │ Pluggable AI & Media Pipeline             │
│  server/db.ts                 │  • Gemini 4 Hydrogen (Structured Scripts) │
│  server/migrations/001_*.sql  │  • Gemini 3.8 Flash Lite TTS (24kHz WAV)  │
│  server/migrations/002_*.sql  │  • g++ / python3 / node Syntax Validators │
│  14 normalized entities       │  • FFmpeg + libass/HarfBuzz (720p MP4)    │
│                               │  • AI Lecturer Engine (Lip-Sync/VideoGen) │
└───────────────────────────────┴───────────────────────────────────────────┘
```

## 2. Authentication, Ownership & Security Architecture

- **Server-Side Sessions (`user_sessions` & `media_tokens`)**: All studio API routes (`/api/projects/*`, `/api/jobs/*`, `/api/exports/*`, `/api/lecturers`, `/api/academy/publish/*`, `/api/audit`, `/api/tools/validate-code`) require a valid server-verified Bearer token. Tokens are stored hashed (SHA-256) in SQLite and kept strictly in browser JS memory (never `localStorage`).
- **Scoped Media Tokens**: `<video>`, `<audio>`, custom lecturer portraits, and MP4/SRT download links authenticate via short-lived `?media_token=` tokens verified against project/lecturer ownership.
- **First-Run Workspace Claim**: When `STUDIO_ADMIN_PASSCODE` is unset, the first instructor to open the studio sets a one-time password via `/api/auth/claim` to unlock existing workspace records (preserving all seeded projects and exported MP4s). Additional instructors can register isolated workspaces via `/api/auth/register`.
- **Resource Ownership Isolation**: Every read, update, render, job poll/cancel, media stream, delete, and publish operation verifies that the requesting user owns the target project (or holds the `admin` role).
- **Upload & Path Protection**: Document uploads (PDF/DOCX/PPTX/TXT, max 15 MB) and portrait uploads (JPG/PNG/WEBP, max 5 MB) validate binary magic headers, enforce likeness consent on custom lecturers, and confine all filesystem access inside `STORAGE_DIR`.
- **External Endpoint Validation**: Webhook and GPU worker URLs block loopback, private network ranges, and cloud metadata endpoints before issuing outbound requests.

## 3. Five-Modality Capability Honesty & AI Lecturer Engine

The platform maintains strict honesty across all 5 production modalities (`server/providers/capabilityRegistry.ts` and `server/providers/lecturerEngine.ts`):

| Modality | Local / Free Capability | External GPU / Paid Adapter | Unconfigured Behavior |
| :--- | :--- | :--- | :--- |
| **Smartboard & Video Assembly** | FFmpeg 1280×720 H.264/AAC + Arabic `libass`/HarfBuzz + fade-ins | — | Always active locally ($0) |
| **Educational Scripts** | — | Gemini 4 Hydrogen (`gemini-4-hydrogen`) | Returns explicit 503 error if `GEMINI_API_KEY` missing (no fabricated scripts) |
| **Narration Speech (TTS)** | Offline cadence fallback (Mode A) | Gemini 3.8 Flash Lite (`gemini-3.8-flash-lite`) Arabic & English WAV | Clearly flags `has_real_tts: false` when offline |
| **Facial Lip-Sync** | — | `SADTALKER_ENDPOINT`, `MUSETALK_ENDPOINT`, `HEYGEN_API_KEY` | Explicitly reports **Provider Not Configured** and renders framed Presenter PiP (`has_real_lipsync: false`) |
| **Generative Lecturer Video** | — | `WAN_VIDEO_ENDPOINT`, `LTX_VIDEO_ENDPOINT`, or opt-in `gemini-omni-1.2-flash` (`ENABLE_PAID_GEMINI_MODELS=true` + explicit per-render consent) | Explicitly reports **Provider Not Configured**; never silently triggers paid APIs |

## 4. Video Production Synchronization Guarantees

- **Speech-Matched Duration**: Each scene's duration matches the probed duration of its synthesized narration track (`durationSec + 0.35s` padding) so narration is never clipped.
- **Drift-Free Subtitles**: Exported `.srt` timestamps are built directly from `ffprobe`-measured rendered clip durations, keeping subtitles aligned across multi-scene lessons.
- **Honest Code Validation**: `server/services/codeValidator.ts` executes real `g++ -fsyntax-only`, `python3 -m py_compile`, and `node --check`. If a required compiler/interpreter is missing, it returns `{ valid: false, unavailable: true }` instead of falsely reporting success.

## 5. Honest Naba Academy Integration Contract

`POST /api/academy/publish/:exportId` follows strict destination confirmation semantics:
- **Remote endpoint unconfigured (`NABA_ACADEMY_API_URL` empty)**: Saves a local `naba.academy.media.publish.v1` manifest with `publish_status = 'prepared_local'` and `academy_published = 0`, returning `{ published: false, remote_confirmed: false }`.
- **Remote endpoint configured**: Signs the JSON payload with HMAC-SHA256 (`X-Naba-Signature` when `NABA_ACADEMY_WEBHOOK_SECRET` is set) and POSTs to `NABA_ACADEMY_API_URL`. Marks `publish_status = 'remote_published'` and `academy_published = 1` **only** when the destination returns HTTP `2xx`; otherwise returns HTTP `502` with `publish_status = 'remote_failed'`.

## 6. Local Development & Verification Commands

```bash
# Install dependencies
npm install

# Run full automated test suite (auth, ownership, uploads, code validation, FFmpeg MP4/SRT, publishing)
npm test

# Type-check codebase
npm run lint

# Build production frontend bundle
npm run build

# Start full-stack server on port 3000
npm run dev
```
