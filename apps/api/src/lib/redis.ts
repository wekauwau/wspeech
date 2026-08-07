import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error('REDIS_URL is required');

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err.message);
});
