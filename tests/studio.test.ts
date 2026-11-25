import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudioApp, type StudioAppContext } from '../server/app.ts';
import { parseEducationalDocument, validateDocumentUpload } from '../server/services/documentParser.ts';
import { validateCodeExample } from '../server/services/codeValidator.ts';
import { detectProviderCapabilities, estimateGenerationCost } from '../server/providers/capabilityRegistry.ts';
import {
  generateLecturerSceneVideo,
  runLipSyncAdapter,
  verifyLecturerConsent,
} from '../server/providers/lecturerEngine.ts';
import { validateExternalEndpointUrl } from '../server/services/security.ts';
import { lookupUserByMediaToken } from '../server/services/auth.ts';
import { initDatabase } from '../server/db.ts';

function parseSrtTimestampToSec(ts: string): number {
  const m = ts.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) return -1;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

describe('Naba AI Video Studio — Comprehensive Security, Reliability & Pipeline Test Suite', () => {
  let ctx: StudioAppContext;
  let tmpStorage: string;
  let primaryToken: string;
  let primaryMediaToken: string;
  let secondUserToken: string;

  beforeAll(async () => {
    tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'naba-studio-test-'));
    process.env.STORAGE_DIR = tmpStorage;
    delete process.env.STUDIO_ADMIN_PASSCODE;
    delete process.env.STUDIO_WORKSPACE_CLAIM_CODE;
    delete process.env.NABA_ACADEMY_API_URL;
    delete process.env.NABA_ACADEMY_WEBHOOK_SECRET;
    delete process.env.SADTALKER_ENDPOINT;
    delete process.env.MUSETALK_ENDPOINT;
    delete process.env.WAN_VIDEO_ENDPOINT;
    delete process.env.LTX_VIDEO_ENDPOINT;
    delete process.env.ENABLE_PAID_GEMINI_MODELS;

    ctx = createStudioApp(':memory:');
  });

  afterAll(() => {
    ctx.studioDb.close();
    fs.rmSync(tmpStorage, { recursive: true, force: true });
  });

  it('creates private database directories, database files, and SQLite sidecars', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'naba-private-db-'));
    const dbPath = path.join(root, 'private', 'studio.sqlite');
    const privateDb = initDatabase(dbPath);

    try {
      expect(fs.statSync(path.dirname(dbPath)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${dbPath}${suffix}`;
        if (fs.existsSync(sidecar)) {
          expect(fs.statSync(sidecar).mode & 0o777).toBe(0o600);
        }
      }
    } finally {
      privateDb.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('upgrades a file-backed migration-001 database through all current migrations', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'naba-migration-test-'));
    const dbPath = path.join(root, 'studio.sqlite');
    const baseDb = new DatabaseSync(dbPath);
    try {
      baseDb.exec(fs.readFileSync(path.resolve(process.cwd(), 'server/migrations/001_initial.sql'), 'utf8'));
      baseDb.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      baseDb.prepare(
        `INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)`,
      ).run('usr-legacy', 'legacy@naba.test', 'Legacy Reviewer', 'unused');
      baseDb.prepare(
        `INSERT INTO lecturers
          (id, name, name_ar, specialty, specialty_ar, bio, bio_ar, image_url, is_custom, consent_verified, consent_note, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      ).run(
        'lec-legacy-custom',
        'Legacy Custom',
        'محاضر سابق',
        'Academic',
        'أكاديمي',
        'Legacy bio',
        'نبذة سابقة',
        '/storage/lecturers/legacy.jpg',
        'self-attested note',
        'usr-legacy',
      );
      baseDb.prepare('INSERT INTO migrations (name) VALUES (?)').run('001_initial.sql');
      baseDb.close();

      const upgraded = initDatabase(dbPath);
      try {
        const tables = upgraded.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>;
        const names = new Set(tables.map((table) => table.name));
        expect(names.has('user_sessions')).toBe(true);
        expect(names.has('media_tokens')).toBe(true);
        expect(names.has('exported_videos')).toBe(true);

        const mediaColumns = upgraded.db
          .prepare('PRAGMA table_info(media_tokens)')
          .all() as Array<{ name: string }>;
        expect(mediaColumns.some((column) => column.name === 'session_token_hash')).toBe(true);
        const legacyConsent = upgraded.db
          .prepare('SELECT consent_verified FROM lecturers WHERE id = ?')
          .get('lec-legacy-custom') as { consent_verified: number };
        expect(legacyConsent.consent_verified).toBe(0);

        const applied = upgraded.db
          .prepare('SELECT name FROM migrations ORDER BY name')
          .all() as Array<{ name: string }>;
        expect(applied.map((row) => row.name)).toContain('002_auth_sessions_and_assets.sql');
        expect(applied.map((row) => row.name)).toContain('003_video_format_and_indexes.sql');
        expect(applied.map((row) => row.name)).toContain('004_session_bound_media_tokens.sql');
        expect(applied.map((row) => row.name)).toContain('005_admin_reviewed_lecturer_consent.sql');
      } finally {
        upgraded.close();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('1. initializes all relational tables including session tables and enforces authentication on protected routes', async () => {
    const health = await request(ctx.app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");
    expect(health.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    const tables = ctx.studioDb.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((t) => t.name));

    for (const expected of [
      'users',
      'user_sessions',
      'media_tokens',
      'projects',
      'educational_materials',
      'scripts',
      'scenes',
      'lecturers',
      'voice_profiles',
      'media_assets',
      'generation_jobs',
      'provider_configs',
      'exported_videos',
      'audit_events',
    ]) {
      expect(tableNames.has(expected)).toBe(true);
    }

    // Unauthenticated requests to protected endpoints MUST fail with 401
    const unauthProjects = await request(ctx.app).get('/api/projects');
    expect(unauthProjects.status).toBe(401);

    const unauthExports = await request(ctx.app).get('/api/exports');
    expect(unauthExports.status).toBe(401);

    // Public workspace claiming remains disabled until an operator provides a setup code.
    const statusRes = await request(ctx.app).get('/api/auth/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.authenticated).toBe(false);
    expect(statusRes.body.claim_required).toBe(false);

    const disabledClaim = await request(ctx.app)
      .post('/api/auth/claim')
      .send({
        claim_code: 'NabaWorkspaceSetupCode#2026',
        password: 'NabaInstructor#2026',
        name: 'Dr. Tariq Al-Mansoor',
      });
    expect(disabledClaim.status).toBe(403);

    process.env.STUDIO_WORKSPACE_CLAIM_CODE = 'NabaWorkspaceSetupCode#2026';
    const claimStatus = await request(ctx.app).get('/api/auth/status');
    expect(claimStatus.body.claim_required).toBe(true);

    const rejectedClaim = await request(ctx.app)
      .post('/api/auth/claim')
      .send({
        claim_code: 'wrong-workspace-setup-code',
        password: 'NabaInstructor#2026',
        name: 'Dr. Tariq Al-Mansoor',
      });
    expect(rejectedClaim.status).toBe(401);

    // First-run one-time claim succeeds and issues Bearer + media tokens
    const claimRes = await request(ctx.app)
      .post('/api/auth/claim')
      .send({
        claim_code: 'NabaWorkspaceSetupCode#2026',
        password: 'NabaInstructor#2026',
        name: 'Dr. Tariq Al-Mansoor',
      });
    expect(claimRes.status).toBe(201);
    expect(claimRes.body.token).toBeTruthy();
    expect(claimRes.body.media_token).toBeTruthy();
    primaryToken = claimRes.body.token;
    primaryMediaToken = claimRes.body.media_token;

    // Second claim attempt MUST fail with 409
    const secondClaim = await request(ctx.app)
      .post('/api/auth/claim')
      .send({
        claim_code: 'NabaWorkspaceSetupCode#2026',
        password: 'AnotherPassword#99',
      });
    expect(secondClaim.status).toBe(409);

    // Bad password login returns 401
    const badLogin = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'instructor@naba.academy', password: 'wrong-password' });
    expect(badLogin.status).toBe(401);

    // Valid login succeeds and demo project is accessible
    const goodLogin = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'instructor@naba.academy', password: 'NabaInstructor#2026' });
    expect(goodLogin.status).toBe(200);

    // Logout revokes the issued session token
    const logoutRes = await request(ctx.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${goodLogin.body.token}`);
    expect(logoutRes.status).toBe(200);
    const afterLogout = await request(ctx.app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${goodLogin.body.token}`);
    expect(afterLogout.status).toBe(401);
    expect(lookupUserByMediaToken(ctx.studioDb.db, goodLogin.body.media_token)).toBeNull();

    // Primary user sees the seeded C++ Variables demo project
    const projRes = await request(ctx.app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${primaryToken}`);
    expect(projRes.status).toBe(200);
    const demo = projRes.body.projects.find((p: { id: string }) => p.id === 'proj-naba-cpp-variables-demo');
    expect(demo).toBeDefined();
    expect(demo.subject).toBe('C++ Programming');
    expect(demo.language).toBe('ar');
  });

  it('2. enforces strict multi-user authorization and resource ownership isolation across projects, jobs, and exports', async () => {
    const regRes = await request(ctx.app)
      .post('/api/auth/register')
      .send({
        email: 'second.instructor@naba.academy',
        name: 'Prof. Omar Al-Harbi',
        password: 'SecondInstructor#2026',
        locale: 'en',
      });
    expect(regRes.status).toBe(201);
    secondUserToken = regRes.body.token;

    // Second user must NOT see Primary user's seeded project in listing
    const listRes = await request(ctx.app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.projects.length).toBe(0);

    // Second user receives 403 on Primary user's project read, update, render, and delete
    const readOther = await request(ctx.app)
      .get('/api/projects/proj-naba-cpp-variables-demo')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(readOther.status).toBe(403);

    const patchOther = await request(ctx.app)
      .patch('/api/projects/proj-naba-cpp-variables-demo')
      .set('Authorization', `Bearer ${secondUserToken}`)
      .send({ title: 'Hijacked' });
    expect(patchOther.status).toBe(403);

    const renderOther = await request(ctx.app)
      .post('/api/projects/proj-naba-cpp-variables-demo/render')
      .set('Authorization', `Bearer ${secondUserToken}`)
      .send({ mode: 'local' });
    expect(renderOther.status).toBe(403);

    const delOther = await request(ctx.app)
      .delete('/api/projects/proj-naba-cpp-variables-demo')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(delOther.status).toBe(403);
  });

  it('3. parses valid TXT/DOCX documents and rejects forged PDFs and unconsented lecturer images', async () => {
    const txtRes = await parseEducationalDocument(
      'lesson.txt',
      Buffer.from('Variables in C++ store typed values.', 'utf8'),
    );
    expect(txtRes.extractedText).toContain('Variables in C++');
    expect(txtRes.checksum.length).toBe(64);

    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>المتغيرات في لغة C++</w:t></w:r></w:p></w:body></w:document>',
    );
    const docxBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const docxRes = await parseEducationalDocument('notes.docx', docxBuf);
    expect(docxRes.extractedText).toContain('المتغيرات في لغة C++');

    const oversizedArchive = Buffer.from(docxBuf);
    const centralEntryOffset = oversizedArchive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralEntryOffset).toBeGreaterThanOrEqual(0);
    oversizedArchive.writeUInt32LE(32 * 1024 * 1024 + 1, centralEntryOffset + 24);
    expect(validateDocumentUpload('oversized.docx', oversizedArchive).ok).toBe(false);

    const encryptedArchive = Buffer.from(docxBuf);
    encryptedArchive.writeUInt16LE(1, centralEntryOffset + 8);
    expect(validateDocumentUpload('encrypted.docx', encryptedArchive).ok).toBe(false);

    const badPdf = validateDocumentUpload('fake.pdf', Buffer.from('NOT_A_PDF'));
    expect(badPdf.ok).toBe(false);

    // Consent check blocks unverified lecturer upload
    const fakeImg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const res = await request(ctx.app)
      .post('/api/lecturers')
      .set('Authorization', `Bearer ${primaryToken}`)
      .field('name', 'Unauthorized Person')
      .field('consent_verified', 'false')
      .attach('image', fakeImg, 'face.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/attestation|authorization/i);

    const submittedLecturer = await request(ctx.app)
      .post('/api/lecturers')
      .set('Authorization', `Bearer ${primaryToken}`)
      .field('name', 'Instructor Portrait for Review')
      .field('consent_verified', 'true')
      .field('consent_note', 'submitted authorization reference')
      .attach('image', fakeImg, 'face.jpg');
    expect(submittedLecturer.status).toBe(201);
    expect(submittedLecturer.body.review_status).toBe('pending');
    expect(submittedLecturer.body.lecturer.consent_verified).toBe(0);
    expect(
      verifyLecturerConsent(
        submittedLecturer.body.lecturer,
        path.join(tmpStorage, 'lecturers', path.basename(submittedLecturer.body.lecturer.image_url)),
      ).ok,
    ).toBe(false);

    const deniedReview = await request(ctx.app)
      .post(`/api/lecturers/${submittedLecturer.body.lecturer.id}/consent-review`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ authorization_reference: 'reviewed authorization #2026-01' });
    expect(deniedReview.status).toBe(403);

    process.env.STUDIO_ADMIN_PASSCODE = 'NabaAdminPasscode#2026';
    const adminLogin = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'instructor@naba.academy', password: 'NabaAdminPasscode#2026' });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.user.role).toBe('admin');

    const approvedReview = await request(ctx.app)
      .post(`/api/lecturers/${submittedLecturer.body.lecturer.id}/consent-review`)
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({ authorization_reference: 'reviewed authorization #2026-01' });
    expect(approvedReview.status).toBe(200);
    expect(approvedReview.body.lecturer.consent_verified).toBe(1);
    expect(approvedReview.body.lecturer.consent_approved_by).toBe('usr-naba-instructor');
    delete process.env.STUDIO_ADMIN_PASSCODE;
  });

  it('4. validates code honestly with real compilers/interpreters and NEVER claims success when a compiler is unavailable', async () => {
    const validCpp = `#include <iostream>
using namespace std;
int main() {
    int age = 20;
    cout << age;
    return 0;
}`;
    const okResult = await validateCodeExample(validCpp, 'cpp');
    expect(okResult.valid).toBe(true);
    expect(okResult.unavailable).toBeFalsy();

    const brokenCpp = `int main() { int age = ; return 0 }`;
    const errResult = await validateCodeExample(brokenCpp, 'cpp');
    expect(errResult.valid).toBe(false);

    // Real JavaScript check via node --check
    const validJs = await validateCodeExample('const age = 20; console.log(age);', 'javascript');
    expect(validJs.valid).toBe(true);
    const brokenJs = await validateCodeExample('const age = ;', 'javascript');
    expect(brokenJs.valid).toBe(false);

    // CRITICAL RELIABILITY TEST: Missing compiler MUST return valid: false, unavailable: true
    const missingGpp = await validateCodeExample(validCpp, 'cpp', {
      gppCommand: 'nonexistent-gpp-compiler-xyz',
    });
    expect(missingGpp.valid).toBe(false);
    expect(missingGpp.unavailable).toBe(true);

    const missingPy = await validateCodeExample('x = 1', 'python', {
      pythonCommand: 'nonexistent-python-xyz',
    });
    expect(missingPy.valid).toBe(false);
    expect(missingPy.unavailable).toBe(true);
  });

  it('5. reports honest 5-modality capabilities, zero-cost Mode A disclosures, and blocks SSRF/unconfigured video providers', async () => {
    const caps = detectProviderCapabilities();
    expect(caps.find((c) => c.provider_key === 'ffmpeg-deterministic-smartboard')?.available).toBe(true);
    expect(caps.find((c) => c.category === 'lip_sync')?.available).toBe(false);
    expect(caps.find((c) => c.id === 'cap-video-gen')?.available).toBe(false);

    const est = estimateGenerationCost('local', 2, 11);
    expect(est.estimated_usd).toBe(0);
    expect(est.warnings_en.length).toBeGreaterThan(0);

    // SSRF protection blocks cloud metadata & private RFC1918 URLs
    expect(validateExternalEndpointUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(validateExternalEndpointUrl('http://10.0.0.5/hook').ok).toBe(false);
    expect(validateExternalEndpointUrl('ftp://example.com/file').ok).toBe(false);

    const realTariqPath = path.resolve(process.cwd(), 'src/assets/images/lecturer_tariq_1795454085234.jpg');

    // Unconfigured lip-sync returns explicit not_configured (never fabricates)
    const lipRes = await runLipSyncAdapter({
      lecturerImagePath: realTariqPath,
      audioWavPath: path.join(tmpStorage, 'none.wav'),
      outputVideoPath: path.join(tmpStorage, 'out.mp4'),
    });
    expect(lipRes.supported).toBe(false);
    expect(lipRes.provider).toBe('not_configured');

    // Unconfigured generative lecturer video returns explicit not_configured (never silently calls paid models)
    const vidRes = await generateLecturerSceneVideo({
      lecturer: {
        id: 'lec-tariq',
        name: 'Dr. Tariq',
        name_ar: 'د. طارق',
        specialty: 'CS',
        specialty_ar: 'حاسوب',
        bio: '',
        bio_ar: '',
        image_url: '/src/assets/images/lecturer_tariq_1795454085234.jpg',
        is_custom: 0,
        consent_verified: 1,
        consent_note: 'ok',
        created_at: new Date().toISOString(),
      },
      lecturerImagePath: realTariqPath,
      environment: {
        id: 'env-coding-studio',
        name: 'Coding Studio',
        name_ar: 'أستوديو برمجة',
        description: 'Dark coding studio',
        description_ar: 'أستوديو برمجة',
        image_url: '/src/assets/images/env_coding_studio_1795454089424.jpg',
        accent_hex: '#C8A24A',
        board_style: 'slate_studio',
      },
      scene: {
        id: 's1',
        project_id: 'p1',
        script_id: null,
        sort_order: 1,
        title: 'Variables',
        scene_type: 'code',
        dialogue: 'Test',
        visual_instructions: '',
        code_snippet: '',
        code_language: 'cpp',
        equation_latex: '',
        bullet_points: [],
        subtitle_text: 'Test',
        duration_sec: 4,
        audio_asset_id: null,
        visual_asset_id: null,
        status: 'draft',
        updated_at: new Date().toISOString(),
      },
      language: 'ar',
      targetDurationSec: 4,
      outputVideoPath: path.join(tmpStorage, 'lec.mp4'),
      allowPaidVideoGen: false,
    });
    expect(vidRes.status).toBe('not_configured');

    // Consent gate blocks unverified lecturer portrait
    const unconsentedVid = await generateLecturerSceneVideo({
      lecturer: {
        id: 'lec-unverified',
        name: 'Unverified',
        name_ar: 'غير موثق',
        specialty: 'CS',
        specialty_ar: 'حاسوب',
        bio: '',
        bio_ar: '',
        image_url: '/src/assets/images/lecturer_tariq_1795454085234.jpg',
        is_custom: 1,
        consent_verified: 0,
        consent_note: '',
        created_at: new Date().toISOString(),
      },
      lecturerImagePath: realTariqPath,
      environment: {
        id: 'env-coding-studio',
        name: 'Coding Studio',
        name_ar: 'أستوديو برمجة',
        description: 'Dark coding studio',
        description_ar: 'أستوديو برمجة',
        image_url: '/src/assets/images/env_coding_studio_1795454089424.jpg',
        accent_hex: '#C8A24A',
        board_style: 'slate_studio',
      },
      scene: {
        id: 's1',
        project_id: 'p1',
        script_id: null,
        sort_order: 1,
        title: 'Variables',
        scene_type: 'code',
        dialogue: 'Test',
        visual_instructions: '',
        code_snippet: '',
        code_language: 'cpp',
        equation_latex: '',
        bullet_points: [],
        subtitle_text: 'Test',
        duration_sec: 4,
        audio_asset_id: null,
        visual_asset_id: null,
        status: 'draft',
        updated_at: new Date().toISOString(),
      },
      language: 'ar',
      targetDurationSec: 4,
      outputVideoPath: path.join(tmpStorage, 'lec2.mp4'),
      allowPaidVideoGen: false,
    });
    expect(unconsentedVid.status).toBe('failed');
    expect(unconsentedVid.provider).toBe('consent-gate');
  });

  it('6. returns honest error when script generation is called without GEMINI_API_KEY (no fabricated scripts)', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const res = await request(ctx.app)
        .post('/api/projects/proj-naba-cpp-variables-demo/script/generate')
        .set('Authorization', `Bearer ${primaryToken}`)
        .send({ topic: 'C++ Pointers', target_duration_sec: 15 });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/GEMINI_API_KEY/i);
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    }
  });

  it('7. runs end-to-end pipeline: CRUD -> material upload/delete -> lecturer-video 503 honesty -> FFmpeg MP4 render -> duration-synced SRT -> honest Academy publish (local, 200 confirmed, 500 failed)', async () => {
    // 1. Create project
    const createRes = await request(ctx.app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({
        title: 'C++ Variables Verification Lesson',
        title_ar: 'درس التحقق من المتغيرات في C++',
        subject: 'C++ Programming',
        education_level: 'undergraduate',
        language: 'ar',
        mode: 'local',
        lecturer_id: 'lec-tariq',
        voice_id: 'voice-ar-tariq',
        environment_id: 'env-coding-studio',
      });
    expect(createRes.status).toBe(201);
    const projectId = createRes.body.project.id as string;

    // 2. Upload and delete an extra material to verify asset lifecycle
    const uploadRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/materials`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .attach('file', Buffer.from('int age = 20; cout << age;', 'utf8'), 'cpp_vars.txt');
    expect(uploadRes.status).toBe(201);
    const matId = uploadRes.body.material.id as string;

    const delMatRes = await request(ctx.app)
      .delete(`/api/projects/${projectId}/materials/${matId}`)
      .set('Authorization', `Bearer ${primaryToken}`);
    expect(delMatRes.status).toBe(200);
    expect(delMatRes.body.deleted).toBe(true);

    // 3. Approve script & add code scene
    const approveRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/script/approve`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ approved_by: 'Dr. Tariq Al-Mansoor' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.project.script.approved).toBe(true);

    const addSceneRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/scenes`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({
        title: 'تخزين القيمة في المتغير age',
        scene_type: 'code',
        dialogue: 'مرحبًا بكم في أكاديمية نبأ. اليوم سنتعلم المتغيرات في لغة سي بلس بلس.',
        code_snippet: '#include <iostream>\nusing namespace std;\nint main() {\n    int age = 20;\n    cout << age;\n    return 0;\n}',
        code_language: 'cpp',
        equation_latex: 'stdout: 20',
        bullet_points: ['int age = 20;', 'cout << age;'],
        subtitle_text: 'مرحبًا بكم في أكاديمية نبأ. اليوم سنتعلم المتغيرات في لغة سي بلس بلس.',
        duration_sec: 3.0,
      });
    expect(addSceneRes.status).toBe(201);
    const sceneId = addSceneRes.body.scene_id as string;

    // 4. Per-scene lecturer video endpoint reports explicit 503 not_configured when unconfigured
    const lecVidRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/scenes/${sceneId}/lecturer-video`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ allow_paid_video_gen: false });
    expect(lecVidRes.status).toBe(503);
    expect(lecVidRes.body.status).toBe('not_configured');

    // 5. Render real 720p H.264/AAC MP4 (Mode A deterministic offline)
    const renderRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/render`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ mode: 'local', allow_cloud_tts: false });
    expect(renderRes.status).toBe(202);
    const jobId = renderRes.body.job.id as string;

    // Second user cannot inspect or cancel Primary user's job
    const jobPeek = await request(ctx.app)
      .get(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(jobPeek.status).toBe(403);

    // 6. Poll until completion
    let jobStatus = renderRes.body.job.status as string;
    let outputVideoId: string | null = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const poll = await request(ctx.app)
        .get(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${primaryToken}`);
      jobStatus = poll.body.job.status;
      outputVideoId = poll.body.job.output_video_id;
      if (['completed', 'failed', 'cancelled'].includes(jobStatus)) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    expect(jobStatus).toBe('completed');
    expect(outputVideoId).toBeTruthy();

    // 7. Verify authenticated media download (via media_token) & block unauth / cross-user access
    const unauthDownload = await request(ctx.app).get(`/api/exports/${outputVideoId}/download`);
    expect(unauthDownload.status).toBe(401);

    const otherDownload = await request(ctx.app)
      .get(`/api/exports/${outputVideoId}/download`)
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(otherDownload.status).toBe(403);

    const mp4Download = await request(ctx.app).get(
      `/api/exports/${outputVideoId}/download?media_token=${encodeURIComponent(primaryMediaToken)}`,
    );
    expect(mp4Download.status).toBe(200);
    expect(mp4Download.body.length).toBeGreaterThan(10_000);

    // 8. Verify MP4 streams (H.264 1280x720 + AAC) AND SRT duration synchronization via ffprobe
    const mp4FilePath = path.join(tmpStorage, 'exports', `${outputVideoId}.mp4`);
    const probeJson = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4FilePath],
        { encoding: 'utf8' },
      ),
    ) as {
      format: { duration: string };
      streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>;
    };

    const videoStream = probeJson.streams.find((s) => s.codec_type === 'video');
    const audioStream = probeJson.streams.find((s) => s.codec_type === 'audio');
    expect(videoStream?.codec_name).toBe('h264');
    expect(videoStream?.width).toBe(1280);
    expect(videoStream?.height).toBe(720);
    expect(audioStream?.codec_name).toBe('aac');

    const actualDurationSec = Number(probeJson.format.duration);
    expect(actualDurationSec).toBeGreaterThan(6.0);

    const srtRes = await request(ctx.app)
      .get(`/api/exports/${outputVideoId}/srt`)
      .set('Authorization', `Bearer ${primaryToken}`);
    expect(srtRes.status).toBe(200);
    expect(srtRes.text).toContain('00:00:00,000 -->');

    // Verify last SRT cue end time stays tightly synchronized with actual MP4 duration (within 0.35s)
    const timeRanges = [...srtRes.text.matchAll(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g)];
    expect(timeRanges.length).toBe(2);
    const lastCueEnd = parseSrtTimestampToSec(timeRanges[timeRanges.length - 1][2]);
    expect(Math.abs(lastCueEnd - actualDurationSec)).toBeLessThan(0.35);

    // 9. Honest Publishing Test A: No NABA_ACADEMY_API_URL -> NEVER claims published: true
    const localPubRes = await request(ctx.app)
      .post(`/api/academy/publish/${outputVideoId}`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ course_id: 'NABA-CS101', lesson_id: 'LESSON-02-VARIABLES', student_access: 'enrolled_students' });
    expect(localPubRes.status).toBe(200);
    expect(localPubRes.body.published).toBe(false);
    expect(localPubRes.body.remote_confirmed).toBe(false);
    expect(localPubRes.body.publish_status).toBe('prepared_local');

    // 10. Honest Publishing Test B & C: Real local HTTP test receiver (200 confirms publish; 500 returns 502 remote_failed)
    let receiverStatusCode = 200;
    let receivedSignature: string | undefined;
    const server = http.createServer((req, res) => {
      receivedSignature = req.headers['x-naba-signature'] as string | undefined;
      req.resume();
      req.on('end', () => {
        res.statusCode = receiverStatusCode;
        res.end(receiverStatusCode === 200 ? '{"ok":true}' : 'upstream failure');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      process.env.NABA_ACADEMY_API_URL = `http://127.0.0.1:${port}/publish`;
      process.env.NABA_ACADEMY_WEBHOOK_SECRET = 'test-webhook-secret';

      // Case B: Destination confirms with HTTP 200
      receiverStatusCode = 200;
      const confirmedPub = await request(ctx.app)
        .post(`/api/academy/publish/${outputVideoId}`)
        .set('Authorization', `Bearer ${primaryToken}`)
        .send({ course_id: 'NABA-CS101', lesson_id: 'LESSON-02-VARIABLES', student_access: 'enrolled_students' });
      expect(confirmedPub.status).toBe(200);
      expect(confirmedPub.body.published).toBe(true);
      expect(confirmedPub.body.remote_confirmed).toBe(true);
      expect(confirmedPub.body.publish_status).toBe('remote_published');
      expect(receivedSignature).toBeTruthy();

      // Case C: Destination fails with HTTP 500 -> studio returns 502 and marks remote_failed
      receiverStatusCode = 500;
      const failedPub = await request(ctx.app)
        .post(`/api/academy/publish/${outputVideoId}`)
        .set('Authorization', `Bearer ${primaryToken}`)
        .send({ course_id: 'NABA-CS101', lesson_id: 'LESSON-02-VARIABLES', student_access: 'enrolled_students' });
      expect(failedPub.status).toBe(502);
      expect(failedPub.body.published).toBe(false);
      expect(failedPub.body.publish_status).toBe('remote_failed');
    } finally {
      delete process.env.NABA_ACADEMY_API_URL;
      delete process.env.NABA_ACADEMY_WEBHOOK_SECRET;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 45000);

  it('8. completes beginner 3-step flow: "Introduction to Variables in C++" in Arabic -> manual script -> 9:16 render -> TTS cache reuse -> stream/download MP4 & SRT -> reopen persistence', async () => {
    // 1. Create project for "Introduction to Variables in C++" in Arabic
    const createRes = await request(ctx.app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({
        title: 'Introduction to Variables in C++',
        title_ar: 'مقدمة في المتغيرات بلغة C++',
        subject: 'Computer Science',
        education_level: 'undergraduate',
        language: 'ar',
        mode: 'local',
        aspect_ratio: '9:16',
        resolution: '720p',
        lecturer_id: 'lec-tariq',
        voice_id: 'voice-ar-tariq',
        environment_id: 'env-coding-studio',
      });
    expect(createRes.status).toBe(201);
    const projectId = createRes.body.project.id as string;
    expect(createRes.body.project.aspect_ratio).toBe('9:16');
    expect(createRes.body.project.resolution).toBe('720p');

    // 2. Paste complete Arabic lesson script (split into 2 scenes with code block)
    const manualScript = `مقدمة في المتغيرات بلغة C++
مرحبًا بكم في أكاديمية نبأ. المتغيرات هي حاويات في الذاكرة لتخزين البيانات وتغييرها أثناء تشغيل البرنامج.

---

مثال عملي للمتغيرات
نعرّف متغيرًا صحيحًا باسم age ونخزن فيه القيمة عشرين ثم نطبعه.
\`\`\`cpp
int age = 20;
cout << age;
\`\`\``;

    const scriptRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/script/manual`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ raw_script: manualScript });
    expect(scriptRes.status).toBe(200);
    expect(scriptRes.body.project.scenes.length).toBe(2);
    expect(scriptRes.body.project.scenes[1].code_snippet).toContain('int age = 20;');

    // 3. Render 9:16 vertical 720x1280 MP4
    const renderRes = await request(ctx.app)
      .post(`/api/projects/${projectId}/render`)
      .set('Authorization', `Bearer ${primaryToken}`)
      .send({ mode: 'local', aspect_ratio: '9:16', resolution: '720p', allow_cloud_tts: false });
    expect(renderRes.status).toBe(202);
    const jobId = renderRes.body.job.id as string;

    let status = renderRes.body.job.status as string;
    let exportId: string | null = null;
    for (let i = 0; i < 100; i++) {
      const poll = await request(ctx.app)
        .get(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${primaryToken}`);
      status = poll.body.job.status;
      exportId = poll.body.job.output_video_id;
      if (['completed', 'failed', 'cancelled'].includes(status)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(status).toBe('completed');
    expect(exportId).toBeTruthy();

    // Verify 9:16 vertical resolution (720x1280) via ffprobe
    const mp4Path = path.join(tmpStorage, 'exports', `${exportId}.mp4`);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4Path],
        { encoding: 'utf8' },
      ),
    ) as { streams: Array<{ codec_type: string; width?: number; height?: number }> };
    const vStream = probe.streams.find((s) => s.codec_type === 'video');
    expect(vStream?.width).toBe(720);
    expect(vStream?.height).toBe(1280);

    // Verify TTS audio cache directory populated
    const cacheDir = path.join(tmpStorage, 'audio_cache');
    expect(fs.existsSync(cacheDir)).toBe(true);
    expect(fs.readdirSync(cacheDir).some((f) => f.endsWith('.wav'))).toBe(true);

    // 4. Preview stream (Range 206) + MP4 download + Arabic SRT download
    const streamRes = await request(ctx.app)
      .get(`/api/exports/${exportId}/stream?media_token=${encodeURIComponent(primaryMediaToken)}`)
      .set('Range', 'bytes=0-1023');
    expect(streamRes.status).toBe(206);

    const downloadRes = await request(ctx.app).get(
      `/api/exports/${exportId}/download?media_token=${encodeURIComponent(primaryMediaToken)}`,
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.length).toBeGreaterThan(10_000);

    const srtRes = await request(ctx.app).get(
      `/api/exports/${exportId}/srt?media_token=${encodeURIComponent(primaryMediaToken)}`,
    );
    expect(srtRes.status).toBe(200);
    expect(srtRes.text).toContain('المتغيرات');

    // 5. Close and reopen project -> confirm all persisted data & export file_exists: true
    const reopenRes = await request(ctx.app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${primaryToken}`);
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.project.title).toBe('Introduction to Variables in C++');
    expect(reopenRes.body.project.aspect_ratio).toBe('9:16');
    expect(reopenRes.body.project.scenes.length).toBe(2);
    expect(reopenRes.body.project.exports[0].id).toBe(exportId);
    expect(reopenRes.body.project.exports[0].resolution).toBe('720x1280');
    expect(reopenRes.body.project.exports[0].file_exists).toBe(true);
  }, 60000);
});

