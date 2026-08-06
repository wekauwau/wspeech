import { z } from 'zod';

export const SubmitTtsJobBody = z.object({
  text: z.string().min(1).max(10000),
  voice: z.string().optional().default('en_US-lessac-medium'),
});

export type SubmitTtsJobBody = z.infer<typeof SubmitTtsJobBody>;

export const TtsJobParams = z.object({
  job_id: z.string().uuid(),
});

export type TtsJobParams = z.infer<typeof TtsJobParams>;

export const TtsJobResponse = z.object({
  job_id: z.string(),
  status: z.enum(['queued', 'processing', 'done', 'failed']),
  audio_url: z.string().nullable().optional(),
  created_at: z.string(),
  completed_at: z.string().nullable().optional(),
});

export type TtsJobResponse = z.infer<typeof TtsJobResponse>;

export const SyncTtsBody = z.object({
  text: z.string().min(1).max(200),
  voice: z.string().optional().default('en_US-lessac-medium'),
});

export type SyncTtsBody = z.infer<typeof SyncTtsBody>;

export interface TtsJobData {
  jobId: string;
  userId: string;
  apiKeyId: string;
  text: string;
  voice: string;
}
