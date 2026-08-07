import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import {
  createTtsQueue,
  WyomingClient,
  TtsJobStatus,
  incrUsage,
} from '@wspeech/shared';

const TTS_QUEUE_INSTANCE = createTtsQueue(process.env.REDIS_URL!);
const PIPER_HOST = process.env.PIPER_HOST ?? 'localhost';
const PIPER_PORT = Number(process.env.PIPER_PORT ?? 10200);

const SubmitTtsBody = z.object({
  text: z.string().min(1).max(10000),
  voice: z.string().optional().default('en_US-lessac-medium'),
});

type SubmitTtsBody = z.infer<typeof SubmitTtsBody>;

const TtsJobParams = z.object({
  job_id: z.string().uuid(),
});

type TtsJobParams = z.infer<typeof TtsJobParams>;

const SyncTtsBody = z.object({
  text: z.string().min(1).max(200),
  voice: z.string().optional().default('en_US-lessac-medium'),
});

type SyncTtsBody = z.infer<typeof SyncTtsBody>;

export async function ttsRoutes(app: FastifyInstance) {
  app.post<{ Body: SubmitTtsBody }>(
    '/v1/tts',
    {
      schema: {
        body: SubmitTtsBody,
        response: {
          202: z.object({
            job_id: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { text, voice } = request.body;
      const userId = request.authApiKey!.userId;
      const apiKeyId = request.authApiKey!.id;

      const job = await db
        .insertInto('tts_jobs')
        .values({
          user_id: userId,
          api_key_id: apiKeyId,
          status: TtsJobStatus.Queued,
          input_text: text,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await TTS_QUEUE_INSTANCE.add(
        'synthesize',
        {
          jobId: job.id,
          userId,
          apiKeyId,
          text,
          voice,
        },
        {
          jobId: job.id,
        },
      );

      // Increment usage counter (characters + requests)
      const sub = await db
        .selectFrom('subscriptions')
        .where('user_id', '=', userId)
        .select(['current_period_start'])
        .executeTakeFirst();

      const periodStart =
        sub?.current_period_start?.toISOString() ?? new Date().toISOString();
      await incrUsage(redis, userId, periodStart, text.length);

      return reply.status(202).send({ job_id: job.id });
    },
  );

  app.get<{ Params: TtsJobParams }>(
    '/v1/tts/:job_id',
    {
      schema: {
        params: TtsJobParams,
        response: {
          200: z.object({
            job_id: z.string(),
            status: z.enum(['queued', 'processing', 'done', 'failed']),
            audio_url: z.string().nullable().optional(),
            created_at: z.string(),
            completed_at: z.string().nullable().optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { job_id } = request.params;
      const userId = request.authApiKey!.userId;

      const job = await db
        .selectFrom('tts_jobs')
        .where('id', '=', job_id)
        .where('user_id', '=', userId)
        .select(['id', 'status', 'audio_url', 'created_at', 'completed_at'])
        .executeTakeFirst();

      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      return reply.send({
        job_id: job.id,
        status: job.status,
        audio_url: job.audio_url,
        created_at: job.created_at.toISOString(),
        completed_at: job.completed_at?.toISOString() ?? null,
      });
    },
  );

  app.post<{ Body: SyncTtsBody }>(
    '/v1/tts/sync',
    {
      schema: {
        body: SyncTtsBody,
        response: {
          200: z.object({
            audio: z.string(),
            content_type: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { text } = request.body;
      const userId = request.authApiKey!.userId;

      const client = new WyomingClient(PIPER_HOST, PIPER_PORT);
      const result = await client.synthesize(text);

      // Increment usage counter
      const sub = await db
        .selectFrom('subscriptions')
        .where('user_id', '=', userId)
        .select(['current_period_start'])
        .executeTakeFirst();

      const periodStart =
        sub?.current_period_start?.toISOString() ?? new Date().toISOString();
      await incrUsage(redis, userId, periodStart, text.length);

      const audioBase64 = result.audio.toString('base64');

      return reply.send({
        audio: audioBase64,
        content_type: 'audio/wav',
      });
    },
  );
}
