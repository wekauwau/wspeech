import type { Redis } from 'ioredis';

// Fixed-window rate limiter using atomic Lua script.
// Key pattern: rl:{identifier}:{window}
// Returns { allowed, current, limit, remaining, resetMs }

const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowSec = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, windowSec)
end

local ttl = redis.call('TTL', key)
local resetMs = ttl * 1000

if current > limit then
  return {0, current, limit, 0, resetMs}
end

return {1, current, limit, limit - current, resetMs}
`;

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetMs: number;
}

let cachedScriptSha: string | null = null;

async function loadScript(redis: Redis): Promise<string> {
  if (cachedScriptSha) return cachedScriptSha;
  const sha = (await redis.script('LOAD', RATE_LIMIT_SCRIPT)) as string;
  cachedScriptSha = sha;
  return sha;
}

export async function checkRateLimit(
  redis: Redis,
  identifier: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const sha = await loadScript(redis);
  const key = `rl:${identifier}:${Math.floor(Date.now() / (windowSec * 1000))}`;

  const result = (await redis.evalsha(
    sha,
    1,
    key,
    String(limit),
    String(windowSec),
  )) as [number, number, number, number, number];

  return {
    allowed: result[0] === 1,
    current: result[1],
    limit: result[2],
    remaining: result[3],
    resetMs: result[4],
  };
}

// Usage counter: atomic INCRBY + no TTL (resets at billing period boundary)
// Key pattern: usage:{userId}:{periodStart}

const USAGE_INCR_SCRIPT = `
local key = KEYS[1]
local chars = tonumber(ARGV[1])

redis.call('HINCRBY', key, 'characters', chars)
redis.call('HINCRBY', key, 'requests', 1)

local characters = tonumber(redis.call('HGET', key, 'characters') or '0')
local requests = tonumber(redis.call('HGET', key, 'requests') or '0')

return {characters, requests}
`;

let cachedUsageSha: string | null = null;

async function loadUsageScript(redis: Redis): Promise<string> {
  if (cachedUsageSha) return cachedUsageSha;
  const sha = (await redis.script('LOAD', USAGE_INCR_SCRIPT)) as string;
  cachedUsageSha = sha;
  return sha;
}

export interface UsageSnapshot {
  characters: number;
  requests: number;
}

export async function incrUsage(
  redis: Redis,
  userId: string,
  periodStart: string,
  characters: number,
): Promise<UsageSnapshot> {
  const sha = await loadUsageScript(redis);
  const key = `usage:${userId}:${periodStart}`;

  const result = (await redis.evalsha(sha, 1, key, String(characters))) as [
    number,
    number,
  ];

  return { characters: result[0], requests: result[1] };
}

export async function getUsage(
  redis: Redis,
  userId: string,
  periodStart: string,
): Promise<UsageSnapshot> {
  const key = `usage:${userId}:${periodStart}`;
  const characters = await redis.hget(key, 'characters');
  const requests = await redis.hget(key, 'requests');

  return {
    characters: Number(characters ?? 0),
    requests: Number(requests ?? 0),
  };
}
