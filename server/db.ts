import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ClassroomEnvironment } from '../src/types/studio.ts';

export const CLASSROOM_ENVIRONMENTS: ClassroomEnvironment[] = [
  {
    id: 'env-lecture-hall',
    name: 'Naba Smart Lecture Hall',
    name_ar: 'قاعة المحاضرات الذكية — أكاديمية نبأ',
    description: 'Deep navy acoustic architecture with warm gold trim and a widescreen smartboard.',
    description_ar: 'قاعة جامعية حديثة بألواح كحلية وإضاءة ذهبية دافئة مع سبورة ذكية عريضة.',
    image_url: '/src/assets/images/env_lecture_hall_1795454090704.jpg',
    accent_hex: '#C8A24A',
    board_style: 'navy_glass',
  },
  {
    id: 'env-coding-studio',
    name: 'Computer Science Broadcast Studio',
    name_ar: 'أستوديو بث علوم الحاسوب والبرمجة',
    description: 'High-contrast dark slate broadcast desk optimized for C++, Python, and engineering code walkthroughs.',
    description_ar: 'أستوديو بث أكاديمي عالي التباين مخصص لشرح الأكواد البرمجية والهندسة.',
    image_url: '/src/assets/images/env_coding_studio_1795454089424.jpg',
    accent_hex: '#D4AF5A',
    board_style: 'slate_studio',
  },
  {
    id: 'env-minimal-board',
    name: 'Academic Minimalist Smartboard',
    name_ar: 'السبورة الأكاديمية الصافية',
    description: 'Clean deep midnight smartboard canvas with maximum clarity for equations and long code listings.',
    description_ar: 'لوح أكاديمي داكن صافٍ لأقصى وضوح للمعادلات الرياضية والأكواد الطويلة.',
    image_url: '/src/assets/images/env_lecture_hall_1795454090704.jpg',
    accent_hex: '#E2C06B',
    board_style: 'chalk_minimal',
  },
];

export const DEFAULT_CPP_DEMO_PROJECT_ID = 'proj-naba-cpp-variables-demo';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface StudioDatabase {
  db: DatabaseSync;
  dbPath: string;
  close: () => void;
}

export function initDatabase(customPath?: string): StudioDatabase {
  const dbPath = customPath ?? process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'data', 'naba_studio.sqlite');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  }

  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    fs.chmodSync(dbPath, 0o600);
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  runMigrations(db);
  seedInitialData(db);
  if (dbPath !== ':memory:') {
    for (const suffix of ['-wal', '-shm']) {
      const sidecarPath = `${dbPath}${suffix}`;
      if (fs.existsSync(sidecarPath)) {
        fs.chmodSync(sidecarPath, 0o600);
      }
    }
  }

  return {
    db,
    dbPath,
    close: () => db.close(),
  };
}

function runMigrations(db: DatabaseSync): void {
  const migrationsDir = path.resolve(process.cwd(), 'server', 'migrations');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  }
}

function seedInitialData(db: DatabaseSync): void {
  // Seed default studio instructor account
  const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get('usr-naba-instructor');
  if (!existingUser) {
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, locale)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'usr-naba-instructor',
      'instructor@naba.academy',
      'د. طارق المنصور',
      'instructor',
      hashPassword('naba-local-workspace-session'),
      'ar',
    );
  }

  // Seed 3 editorial virtual lecturers using generated portraits
  const lecturers = [
    {
      id: 'lec-tariq',
      name: 'Dr. Tariq Al-Mansoor',
      name_ar: 'د. طارق المنصور',
      specialty: 'Computer Science & C++ Systems',
      specialty_ar: 'علوم الحاسوب وبرمجة الأنظمة',
      bio: 'Senior university lecturer specializing in C++, algorithms, and structured programming fundamentals.',
      bio_ar: 'محاضر جامعي متخصص في لغة سي بلس بلس والخوارزميات وهندسة البرمجيات التأسيسية.',
      image_url: '/src/assets/images/lecturer_tariq_1795454085234.jpg',
    },
    {
      id: 'lec-layla',
      name: 'Dr. Layla Al-Harbi',
      name_ar: 'د. ليلى الحربي',
      specialty: 'Mathematics & Applied Physics',
      specialty_ar: 'الرياضيات والفيزياء التطبيقية',
      bio: 'Academic educator focused on calculus, linear algebra, and conceptual physics demonstrations.',
      bio_ar: 'أكاديمية متخصصة في التفاضل والتكامل والجبر الخطي وتبسيط مفاهيم الفيزياء.',
      image_url: '/src/assets/images/lecturer_layla_1795454088989.jpg',
    },
    {
      id: 'lec-omar',
      name: 'Prof. Omar Al-Sharif',
      name_ar: 'أ. عمر الشريف',
      specialty: 'Software Architecture & Data Science',
      specialty_ar: 'هندسة البرمجيات وعلم البيانات',
      bio: 'Industry-grounded lecturer teaching modern engineering workflows, Python, and system design.',
      bio_ar: 'محاضر هندسي يركز على تصميم الأنظمة البرمجية الحديثة ولغة بايثون وعلم البيانات.',
      image_url: '/src/assets/images/lecturer_omar_1795454090645.jpg',
    },
  ];

  const insertLecturer = db.prepare(`
    INSERT OR IGNORE INTO lecturers
      (id, name, name_ar, specialty, specialty_ar, bio, bio_ar, image_url, is_custom, consent_verified, consent_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'Naba Academy licensed studio presenter asset')
  `);
  for (const l of lecturers) {
    insertLecturer.run(l.id, l.name, l.name_ar, l.specialty, l.specialty_ar, l.bio, l.bio_ar, l.image_url);
  }

  // Seed 6 Arabic & English neural voice profiles (Gemini 3.8 Flash Lite TTS)
  const voices = [
    {
      id: 'voice-ar-tariq',
      name: 'Tariq (Modern Standard Arabic — Warm Academic)',
      name_ar: 'طارق (العربية الفصحى — نبرة أكاديمية دافئة)',
      language: 'ar',
      provider: 'gemini-3.8-flash-lite-tts',
      provider_voice_id: 'Charon',
      gender: 'male',
      style_prompt: 'Clear, authoritative Modern Standard Arabic university professor lecturing calmly with crisp pronunciation of English technical terms.',
      speaking_rate: 1.0,
    },
    {
      id: 'voice-ar-layla',
      name: 'Layla (Modern Standard Arabic — Articulate)',
      name_ar: 'ليلى (العربية الفصحى — شرح واضح ومنظم)',
      language: 'ar',
      provider: 'gemini-3.8-flash-lite-tts',
      provider_voice_id: 'Kore',
      gender: 'female',
      style_prompt: 'Warm, articulate Modern Standard Arabic university instructor delivering clear educational explanations.',
      speaking_rate: 1.0,
    },
    {
      id: 'voice-ar-omar',
      name: 'Omar (Modern Standard Arabic — Energetic STEM)',
      name_ar: 'عمر (العربية الفصحى — حيوي للمواد العلمية)',
      language: 'ar',
      provider: 'gemini-3.8-flash-lite-tts',
      provider_voice_id: 'Fenrir',
      gender: 'male',
      style_prompt: 'Engaging, steady Arabic computer science instructor explaining code step by step.',
      speaking_rate: 1.0,
    },
    {
      id: 'voice-en-academic-m',
      name: 'Daniel (English — University Professor)',
      name_ar: 'دانيال (الإنجليزية — أستاذ جامعي)',
      language: 'en',
      provider: 'gemini-3.8-flash-lite-tts',
      provider_voice_id: 'Charon',
      gender: 'male',
      style_prompt: 'Clear, measured English university professor explaining computer science concepts.',
      speaking_rate: 1.0,
    },
    {
      id: 'voice-en-academic-f',
      name: 'Nadia (English — Crisp STEM Educator)',
      name_ar: 'نادية (الإنجليزية — محاضرة علوم وهندسة)',
      language: 'en',
      provider: 'gemini-3.8-flash-lite-tts',
      provider_voice_id: 'Zephyr',
      gender: 'female',
      style_prompt: 'Bright, structured English STEM educator delivering engaging lesson narration.',
      speaking_rate: 1.0,
    },
    {
      id: 'voice-en-studio',
      name: 'Samir (English — Technical Walkthrough)',
      name_ar: 'سمير (الإنجليزية — شرح تقني وتطبيقي)',
      language: 'en',
      provider: 'gemini-3.8-flash-lite-tts',
      provider_voice_id: 'Puck',
      gender: 'male',
      style_prompt: 'Approachable technical instructor explaining software code clearly.',
      speaking_rate: 1.0,
    },
  ];

  const insertVoice = db.prepare(`
    INSERT OR IGNORE INTO voice_profiles
      (id, name, name_ar, language, provider, provider_voice_id, gender, style_prompt, speaking_rate, is_free_tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const v of voices) {
    insertVoice.run(
      v.id,
      v.name,
      v.name_ar,
      v.language,
      v.provider,
      v.provider_voice_id,
      v.gender,
      v.style_prompt,
      v.speaking_rate,
    );
  }

  // Seed First Demonstration Project (Section 19: C++ Programming — Introduction to Variables)
  const existingDemo = db.prepare('SELECT id FROM projects WHERE id = ?').get(DEFAULT_CPP_DEMO_PROJECT_ID);
  if (!existingDemo) {
    const cppExample = `#include <iostream>
using namespace std;

int main() {
    int age = 20;
    cout << age;
    return 0;
}`;

    db.prepare(
      `INSERT INTO projects
        (id, user_id, title, title_ar, subject, education_level, language, mode, lecturer_id, voice_id, environment_id, status, academy_course_id, academy_lesson_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      DEFAULT_CPP_DEMO_PROJECT_ID,
      'usr-naba-instructor',
      'C++ Programming: Introduction to Variables',
      'برمجة C++: مقدمة في المتغيرات',
      'C++ Programming',
      'undergraduate',
      'ar',
      'local',
      'lec-tariq',
      'voice-ar-tariq',
      'env-coding-studio',
      'script_approved',
      'NABA-CS101',
      'LESSON-02-VARIABLES',
    );

    const scriptId = 'scr-naba-cpp-demo-v1';
    db.prepare(
      `INSERT INTO scripts
        (id, project_id, version, learning_objectives_json, key_concepts_json, summary, source_attribution_json, approved, approved_by, approved_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?, datetime('now'))`,
    ).run(
      scriptId,
      DEFAULT_CPP_DEMO_PROJECT_ID,
      JSON.stringify([
        'فهم مفهوم المتغير (Variable) كموقع مسمّى في ذاكرة الحاسوب لتخزين البيانات.',
        'التعرف على نوع البيانات الصحيح int وإسناد قيمة ابتدائية في لغة C++.',
        'طباعة قيمة المتغير على الشاشة باستخدام cout في الدالة الرئيسية main().',
      ]),
      JSON.stringify(['int (نوع عددي صحيح)', 'age (معرّف المتغير)', '= 20 (إسناد القيمة)', 'cout << age (الطباعة)']),
      'درس تأسيسي مدته نحو 10 ثوانٍ لأكاديمية نبأ يقدّم تعريف المتغيرات في لغة C++ عبر مثال عملي موثق ومترجم نحويًا.',
      JSON.stringify({
        source_grounded_points: [
          'مثال C++ الأساسي: int age = 20; cout << age;',
          'نص المحاضر الافتتاحي المعتمد لأكاديمية نبأ.',
        ],
        ai_elaboration_points: [
          'تقسيم الشرح إلى مشهدين متناسقين (مقدمة السبورة الذكية + تفصيل الكود والنتيجة).',
        ],
        citation_note: 'تم التحقق النحوي من الكود مباشرة بواسطة مترجم g++ المحلي بدون أخطاء.',
      }),
      'د. طارق المنصور',
    );

    const insertScene = db.prepare(`
      INSERT INTO scenes
        (id, project_id, script_id, sort_order, title, scene_type, dialogue, visual_instructions, code_snippet, code_language, equation_latex, bullet_points_json, subtitle_text, duration_sec, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `);

    insertScene.run(
      'scn-cpp-demo-1',
      DEFAULT_CPP_DEMO_PROJECT_ID,
      scriptId,
      1,
      'مقدمة في المتغيرات — لغة C++',
      'intro',
      'مرحبًا بكم في أكاديمية نبأ. اليوم سنتعلم المتغيرات في لغة سي بلس بلس، وكيف نستخدمها لتخزين البيانات.',
      'عرض عنوان الدرس على السبورة الذكية الكحلية مع بطاقة المحاضر د. طارق المنصور وتوضيح مفهوم المتغير في الذاكرة.',
      '',
      'cpp',
      '',
      JSON.stringify([
        'المتغير (Variable): مساحة محجوزة في الذاكرة لها اسم ونوع بيانات',
        'النوع int يُستخدم لتخزين الأعداد الصحيحة مثل العمر (age)',
        'نطبع القيمة على الشاشة باستخدام cout << age',
      ]),
      'مرحبًا بكم في أكاديمية نبأ. اليوم سنتعلم المتغيرات في لغة سي بلس بلس، وكيف نستخدمها لتخزين البيانات.',
      6.0,
    );

    insertScene.run(
      'scn-cpp-demo-2',
      DEFAULT_CPP_DEMO_PROJECT_ID,
      scriptId,
      2,
      'مثال تطبيقي: تعريف وطباعة المتغير age',
      'code',
      'في هذا المثال نُعرّف المتغير age من النوع int بقيمة عشرين، ثم نطبعه باستخدام الأمر cout.',
      'إظهار الكود البرمجي بتنسيق ثابت أحادي العرض مع تمييز سطر تعريف المتغير int age = 20 ومخرجات التنفيذ 20.',
      cppExample,
      'cpp',
      'Memory[age] = 20  ->  stdout: 20',
      JSON.stringify([
        'int age = 20;  — حجز متغير عددي صحيح وتخزين 20 داخله',
        'cout << age;   — إرسال قيمة المتغير إلى شاشة الإخراج',
        'المخرج النهائي عند التشغيل: 20',
      ]),
      'في هذا المثال نُعرّف المتغير age من النوع int بقيمة 20، ثم نطبعه باستخدام cout.',
      5.0,
    );

    db.prepare(
      `INSERT INTO audit_events (id, user_id, project_id, action, entity_type, entity_id, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'aud-seed-demo-1',
      'usr-naba-instructor',
      DEFAULT_CPP_DEMO_PROJECT_ID,
      'project_seeded',
      'project',
      DEFAULT_CPP_DEMO_PROJECT_ID,
      JSON.stringify({ demo: 'Naba Academy C++ Variables 10s Demonstration' }),
    );
  }
}

export function recordAuditEvent(
  db: DatabaseSync,
  params: {
    userId?: string | null;
    projectId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO audit_events (id, user_id, project_id, action, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `aud-${crypto.randomUUID().slice(0, 12)}`,
    params.userId ?? 'usr-naba-instructor',
    params.projectId ?? null,
    params.action,
    params.entityType,
    params.entityId,
    JSON.stringify(params.details ?? {}),
  );
}
