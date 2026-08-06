import { Queue } from 'bullmq';
import type { TtsJobData } from './schemas.js';

export const TTS_QUEUE = 'tts-jobs';

export function createTtsQueue(redisUrl: string) {
  return new Queue<TtsJobData>(TTS_QUEUE, {
    connection: {
      url: redisUrl,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });
}
