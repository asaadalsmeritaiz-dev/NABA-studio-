import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createStudioApp } from '../server/app.ts';
import { DEFAULT_CPP_DEMO_PROJECT_ID } from '../server/db.ts';

async function main() {
  const { studioDb, jobManager } = createStudioApp();
  const { db } = studioDb;

  const existing = db
    .prepare('SELECT id, file_path, duration_sec, size_bytes FROM exported_videos WHERE project_id = ? LIMIT 1')
    .get(DEFAULT_CPP_DEMO_PROJECT_ID) as
    | { id: string; file_path: string; duration_sec: number; size_bytes: number }
    | undefined;

  if (existing) {
    console.log('Demo MP4 already exists:', existing);
    studioDb.close();
    return;
  }

  console.log('Starting FFmpeg render for Naba Academy C++ Variables demo...');
  const job = jobManager.startRenderJob(DEFAULT_CPP_DEMO_PROJECT_ID, 'local', {
    allowCloudTts: true,
  });

  let status: string = job.status;
  let outputVideoId: string | null = null;
  for (let i = 0; i < 90; i++) {
    const row = db
      .prepare('SELECT status, progress_pct, current_stage, error_message, output_video_id FROM generation_jobs WHERE id = ?')
      .get(job.id) as {
      status: string;
      progress_pct: number;
      current_stage: string;
      error_message: string | null;
      output_video_id: string | null;
    };
    status = row.status;
    outputVideoId = row.output_video_id;
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      if (status !== 'completed') {
        throw new Error(`Demo render ended with status=${status}: ${row.error_message}`);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (status !== 'completed' || !outputVideoId) {
    throw new Error('Demo video render did not complete in time.');
  }

  const exported = db
    .prepare('SELECT id, file_path, srt_path, duration_sec, resolution, size_bytes, render_mode, has_real_tts, has_real_lipsync FROM exported_videos WHERE id = ?')
    .get(outputVideoId) as Record<string, unknown>;

  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'compact=p=0:nk=1', String(exported.file_path)],
    { encoding: 'utf8' },
  );

  console.log('DEMO_MP4_CREATED:', JSON.stringify(exported, null, 2));
  console.log('FFPROBE_VERIFIED_LINES:', probe.trim().split('\n').length);
  studioDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
