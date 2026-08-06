import { Worker, Job } from 'bullmq';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  TTS_QUEUE,
  WyomingClient,
  TtsJobStatus,
  type TtsJobData,
} from '@wspeech/shared';
import type { DB } from '@wspeech/shared';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const REDIS_URL = process.env.REDIS_URL as string;
if (!REDIS_URL) throw new Error('REDIS_URL is required');

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});

const PIPER_HOST = process.env.PIPER_HOST ?? 'localhost';
const PIPER_PORT = Number(process.env.PIPER_PORT ?? 10200);
const AUDIO_DIR = process.env.AUDIO_DIR ?? './audio';

async function ensureAudioDir() {
  await fs.mkdir(AUDIO_DIR, { recursive: true });
}

async function processTtsJob(job: Job<TtsJobData>) {
  const { jobId, text } = job.data;

  await db
    .updateTable('tts_jobs')
    .set({ status: TtsJobStatus.Processing })
    .where('id', '=', jobId)
    .execute();

  try {
    const client = new WyomingClient(PIPER_HOST, PIPER_PORT);
    const result = await client.synthesize(text);

    const filename = `${jobId}.wav`;
    const filepath = path.join(AUDIO_DIR, filename);
    await fs.writeFile(filepath, result.audio);

    const audioUrl = `/audio/${filename}`;

    await db
      .updateTable('tts_jobs')
      .set({
        status: TtsJobStatus.Done,
        audio_url: audioUrl,
        completed_at: new Date(),
      })
      .where('id', '=', jobId)
      .execute();

    console.log(`Job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);

    await db
      .updateTable('tts_jobs')
      .set({
        status: TtsJobStatus.Failed,
        completed_at: new Date(),
      })
      .where('id', '=', jobId)
      .execute();

    throw error;
  }
}

async function start() {
  await ensureAudioDir();

  const worker = new Worker<TtsJobData>(
    TTS_QUEUE,
    async (job) => {
      return processTtsJob(job);
    },
    {
      connection: {
        url: REDIS_URL,
      },
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  console.log('TTS Worker started, waiting for jobs...');
}

start().catch((err) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
