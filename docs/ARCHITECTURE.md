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
- **First-Run Workspace Claim**: A first-run claim is available only when an operator configures `STUDIO_WORKSPACE_CLAIM_CODE` (at least 16 characters) and no `STUDIO_ADMIN_PASSCODE` is configured. The instructor must provide that setup code and chooses a separate account password. Without either configured credential, public claim is disabled; users may register a separate workspace instead. Additional instructors can register isolated workspaces via `/api/auth/register`.
- **Session-Bound Media Tokens**: Media tokens are associated with the session that issued them. Logging out revokes both that session and its media token; older unassociated tokens are revoked on logout for the same account.
- **Private Runtime Storage**: Newly created database directories use mode `0700`, database and SQLite sidecar files use `0600`, and the media storage root is restricted to its owner.
- **Custom Lecturer Consent**: Uploaders submit a likeness with an attestation, but it remains unverified and unusable for provider generation. An authenticated administrator must review and approve the authorization reference through the Library or `POST /api/lecturers/:id/consent-review`; approver and timestamp are audited and persisted.
- **Resource Ownership Isolation**: Every read, update, render, job poll/cancel, media stream, delete, and publish operation verifies that the requesting user owns the target project (or holds the `admin` role).
- **Upload & Path Protection**: Document uploads (PDF/DOCX/PPTX/TXT, max 15 MB) and portrait uploads (JPG/PNG/WEBP, max 5 MB) validate binary magic headers, enforce likeness consent on custom lecturers, and confine all filesystem access inside `STORAGE_DIR`.
- **Office Archive Bounds**: DOCX/PPTX ZIP central directories are checked before extraction: at most 1,000 entries, 32 MB per entry, 64 MB combined expanded size, no encrypted entries, and only stored/deflate compression.
- **Untrusted Educational Sources**: Uploaded source text is length-bounded, JSON-quoted, and explicitly treated as untrusted reference data in script-generation instructions; embedded requests cannot override system instructions or output structure.
- **Browser Security Headers**: The Express app sets a restrictive same-origin Content Security Policy (with explicit Google Fonts, local media/data URLs, and Vite websocket allowances), denies framing, disables MIME sniffing, and restricts referrer disclosure. Terminate TLS at a trusted proxy; HSTS is intentionally not set by the app so local HTTP development continues to work.
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

The production Docker image runs as the unprivileged `node` user. Its `/app/data` and `/app/storage` mount points are created with owner-only access. For bind mounts, ensure the host directories are writable by the container's `node` UID; named Docker volumes are initialized from the image permissions.

### First-run authentication configuration

For an existing seeded workspace, set a private `STUDIO_WORKSPACE_CLAIM_CODE` of at least 16 characters before starting the server. Keep it out of source control and share it only with the intended workspace owner. The owner uses it once to set their own account password. Alternatively, configure `STUDIO_ADMIN_PASSCODE` to enable the managed default workspace administrator login; that configured account receives the admin role for protected administration, including lecturer-consent review. Do not expose a server with neither option configured if the seeded workspace must be claimed.

```bash
# Prerequisites: Node.js 24 LTS, Bun 1.4.5, and FFmpeg
bun install --frozen-lockfile

# Run full automated test suite (auth, ownership, uploads, code validation, FFmpeg MP4/SRT, publishing)
bun run test

# Type-check codebase
bun run lint

# Build production frontend bundle
bun run build

# Start full-stack server on port 3000
bun run dev
```
