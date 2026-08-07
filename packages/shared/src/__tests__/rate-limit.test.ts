import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import { checkRateLimit, incrUsage, getUsage } from '../rate-limit.js';

const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  password: 'wspeech',
  maxRetriesPerRequest: 3,
});

beforeAll(async () => {
  await redis.ping();
});

afterAll(async () => {
  await redis.flushdb();
  await redis.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const result = await checkRateLimit(redis, 'key1', 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.remaining).toBe(4);
  });

  it('rejects requests over the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(redis, 'key1', 5, 60);
    }
    const result = await checkRateLimit(redis, 'key1', 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(6);
    expect(result.remaining).toBe(0);
  });

  it('uses separate counters per identifier', async () => {
    await checkRateLimit(redis, 'key1', 2, 60);
    await checkRateLimit(redis, 'key1', 2, 60);

    const result = await checkRateLimit(redis, 'key2', 2, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('resets after window expires', async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(redis, 'key1', 3, 1);
    }
    const blocked = await checkRateLimit(redis, 'key1', 3, 1);
    expect(blocked.allowed).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));

    const after = await checkRateLimit(redis, 'key1', 3, 1);
    expect(after.allowed).toBe(true);
    expect(after.current).toBe(1);
  });

  it('handles concurrent requests without race conditions', async () => {
    const LIMIT = 10;
    const CONCURRENT = 20;

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        checkRateLimit(redis, 'concurrent-key', LIMIT, 60),
      ),
    );

    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;

    expect(allowed).toBe(LIMIT);
    expect(rejected).toBe(CONCURRENT - LIMIT);
  });

  it('returns correct resetMs based on TTL', async () => {
    const result = await checkRateLimit(redis, 'key1', 10, 60);
    expect(result.resetMs).toBeGreaterThan(0);
    expect(result.resetMs).toBeLessThanOrEqual(60_000);
  });
});

describe('incrUsage', () => {
  it('increments character and request counts atomically', async () => {
    const snap1 = await incrUsage(redis, 'user1', '2026-01-01', 100);
    expect(snap1.characters).toBe(100);
    expect(snap1.requests).toBe(1);

    const snap2 = await incrUsage(redis, 'user1', '2026-01-01', 50);
    expect(snap2.characters).toBe(150);
    expect(snap2.requests).toBe(2);
  });

  it('uses separate counters per billing period', async () => {
    await incrUsage(redis, 'user1', '2026-01-01', 100);
    await incrUsage(redis, 'user1', '2026-02-01', 200);

    const jan = await getUsage(redis, 'user1', '2026-01-01');
    expect(jan.characters).toBe(100);
    expect(jan.requests).toBe(1);

    const feb = await getUsage(redis, 'user1', '2026-02-01');
    expect(feb.characters).toBe(200);
    expect(feb.requests).toBe(1);
  });

  it('handles concurrent increments without lost updates', async () => {
    const INCREMENTS = 50;
    const CHARS_PER = 10;

    await Promise.all(
      Array.from({ length: INCREMENTS }, () =>
        incrUsage(redis, 'user1', '2026-01-01', CHARS_PER),
      ),
    );

    const snap = await getUsage(redis, 'user1', '2026-01-01');
    expect(snap.characters).toBe(INCREMENTS * CHARS_PER);
    expect(snap.requests).toBe(INCREMENTS);
  });
});

describe('getUsage', () => {
  it('returns zeros for unknown user/period', async () => {
    const snap = await getUsage(redis, 'unknown', '2026-01-01');
    expect(snap.characters).toBe(0);
    expect(snap.requests).toBe(0);
  });
});
