import { describe, it, expect, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { checkRateLimit } from '../rate-limit.js';

const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  password: 'wspeech',
  maxRetriesPerRequest: 3,
});

afterAll(async () => {
  await redis.quit();
});

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const result = await checkRateLimit(redis, `key1-${Date.now()}`, 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.remaining).toBe(4);
  });

  it('rejects requests over the limit', async () => {
    const key = `key2-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(redis, key, 5, 60);
    }
    const result = await checkRateLimit(redis, key, 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(6);
    expect(result.remaining).toBe(0);
  });

  it('uses separate counters per identifier', async () => {
    const key1 = `key3a-${Date.now()}`;
    const key2 = `key3b-${Date.now()}`;
    await checkRateLimit(redis, key1, 2, 60);
    await checkRateLimit(redis, key1, 2, 60);

    const result = await checkRateLimit(redis, key2, 2, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('resets after window expires', async () => {
    const key = `key4-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(redis, key, 3, 2);
    }
    const blocked = await checkRateLimit(redis, key, 3, 2);
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 2100));

    const after = await checkRateLimit(redis, key, 3, 2);
    expect(after.allowed).toBe(true);
    expect(after.current).toBe(1);
  });

  it('handles concurrent requests without race conditions', async () => {
    const key = `concurrent-${Date.now()}`;
    const LIMIT = 10;
    const CONCURRENT = 20;

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        checkRateLimit(redis, key, LIMIT, 60),
      ),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;

    expect(allowed).toBe(LIMIT);
    expect(rejected).toBe(CONCURRENT - LIMIT);
  });

  it('returns correct resetMs based on TTL', async () => {
    const result = await checkRateLimit(redis, `key6-${Date.now()}`, 10, 60);
    expect(result.resetMs).toBeGreaterThan(0);
    expect(result.resetMs).toBeLessThanOrEqual(60_000);
  });
});
