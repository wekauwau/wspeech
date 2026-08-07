import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { getUsage, SubscriptionTier } from '@wspeech/shared';

// Tier quotas (characters per month)
const TIER_QUOTAS: Record<string, number> = {
  free: 10_000,
  starter: 100_000,
  pro: 1_000_000,
  enterprise: 10_000_000,
};

export async function usageRoutes(app: FastifyInstance) {
  app.get(
    '/v1/usage',
    {
      schema: {
        response: {
          200: z.object({
            characters_used: z.number(),
            characters_limit: z.number(),
            requests_count: z.number(),
            period_start: z.string(),
            period_end: z.string().nullable(),
            tier: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.id;

      // Get subscription for tier + billing period
      const sub = await db
        .selectFrom('subscriptions')
        .where('user_id', '=', userId)
        .select(['tier', 'current_period_start', 'current_period_end'])
        .executeTakeFirst();

      const tier = sub?.tier ?? SubscriptionTier.Free;
      const periodStart =
        sub?.current_period_start?.toISOString() ?? new Date().toISOString();
      const periodEnd = sub?.current_period_end?.toISOString() ?? null;

      // Get live usage from Redis
      const usage = await getUsage(redis, userId, periodStart);

      // Fallback to DB if Redis has nothing (cold start or after flush)
      if (usage.characters === 0 && usage.requests === 0) {
        const record = await db
          .selectFrom('usage_records')
          .where('user_id', '=', userId)
          .where('billing_period_start', '=', new Date(periodStart))
          .select(['characters_used', 'requests_count'])
          .executeTakeFirst();

        return reply.send({
          characters_used: Number(record?.characters_used ?? 0),
          characters_limit: TIER_QUOTAS[tier] ?? TIER_QUOTAS.free,
          requests_count: record?.requests_count ?? 0,
          period_start: periodStart,
          period_end: periodEnd,
          tier,
        });
      }

      return reply.send({
        characters_used: usage.characters,
        characters_limit: TIER_QUOTAS[tier] ?? TIER_QUOTAS.free,
        requests_count: usage.requests,
        period_start: periodStart,
        period_end: periodEnd,
        tier,
      });
    },
  );
}
