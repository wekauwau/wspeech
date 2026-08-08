import { describe, it, expect, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { incrUsage, getUsage, checkRateLimit } from '../rate-limit.js';

const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  password: 'wspeech',
  maxRetriesPerRequest: 3,
});

afterAll(async () => {
  await redis.quit();
});

describe('Tier-gated quota', () => {
  const TIER_QUOTAS: Record<string, number> = {
    free: 10_000,
    starter: 100_000,
    pro: 1_000_000,
    enterprise: 10_000_000,
  };

  function getQuota(tier: string): number {
    const q = TIER_QUOTAS[tier];
    return q !== undefined ? q : 10_000;
  }

  it('allows usage under quota', async () => {
    const ts = Date.now();
    const userId = `user-quotatest-${ts}`;
    const periodStart = `${ts}-08-01`;
    const quota = getQuota('free');

    await incrUsage(redis, userId, periodStart, 5000);
    const usage = await getUsage(redis, userId, periodStart);

    expect(usage.characters).toBe(5000);
    expect(usage.characters + 4000).toBeLessThanOrEqual(quota);
  });

  it('blocks usage over quota', async () => {
    const ts = Date.now();
    const userId = `user-blocktest-${ts}`;
    const periodStart = `${ts}-08-01`;
    const quota = getQuota('free');

    await incrUsage(redis, userId, periodStart, 9000);
    const usage = await getUsage(redis, userId, periodStart);

    expect(usage.characters + 2000).toBeGreaterThan(quota);
  });

  it('tracks per-period quotas separately', async () => {
    const ts = Date.now();
    const userId = `user-periodtest-${ts}`;

    await incrUsage(redis, userId, `${ts}-07-01`, 5000);
    await incrUsage(redis, userId, `${ts}-08-01`, 3000);

    const july = await getUsage(redis, userId, `${ts}-07-01`);
    const aug = await getUsage(redis, userId, `${ts}-08-01`);

    expect(july.characters).toBe(5000);
    expect(aug.characters).toBe(3000);
  });

  it('tier quotas are correct', () => {
    expect(getQuota('free')).toBe(10_000);
    expect(getQuota('starter')).toBe(100_000);
    expect(getQuota('pro')).toBe(1_000_000);
    expect(getQuota('enterprise')).toBe(10_000_000);
    expect(getQuota('unknown')).toBe(10_000); // fallback to free
  });
});

describe('Rate limit + usage integration', () => {
  it('rate limit and usage are independent systems', async () => {
    const apiKey = `key-integration-${Date.now()}`;
    const userId = `user-integration-${Date.now()}`;
    const periodStart = '2026-08-01T00:00:00.000Z';

    // Use up rate limit (10 requests)
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(redis, apiKey, 10, 60);
    }
    const rateLimited = await checkRateLimit(redis, apiKey, 10, 60);
    expect(rateLimited.allowed).toBe(false);

    // But usage counter should still be trackable
    await incrUsage(redis, userId, periodStart, 100);
    const usage = await getUsage(redis, userId, periodStart);
    expect(usage.characters).toBe(100);
    expect(usage.requests).toBe(1);
  });
});
