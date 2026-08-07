import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from './jwt.js';
import { verifyApiKey } from './api-key.js';
import { db } from './db.js';
import { redis } from './redis.js';
import { checkRateLimit } from '@wspeech/shared';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: { id: string; email: string };
    authApiKey?: { id: string; userId: string };
  }
}

export async function requireJwtAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid token' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyJwt(token);
    const user = await db
      .selectFrom('users')
      .where('id', '=', decoded.sub)
      .select(['id', 'email'])
      .executeTakeFirst();

    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    request.authUser = user;
  } catch {
    return reply.status(401).send({ error: 'Invalid token' });
  }
}

export async function requireApiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const apiKey = request.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    return reply.status(401).send({ error: 'Missing API key' });
  }

  const result = await verifyApiKey(apiKey);
  if (!result) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }

  request.authApiKey = result;
}

// Rate limit: 10 requests per 60-second window per API key
const RATE_LIMIT = 10;
const RATE_WINDOW_SEC = 60;

export async function requireRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const apiKeyId = request.authApiKey?.id;
  if (!apiKeyId) return;

  const result = await checkRateLimit(
    redis,
    apiKeyId,
    RATE_LIMIT,
    RATE_WINDOW_SEC,
  );

  reply.header('X-RateLimit-Limit', result.limit);
  reply.header('X-RateLimit-Remaining', result.remaining);
  reply.header('X-RateLimit-Reset', Math.ceil(result.resetMs / 1000));

  if (!result.allowed) {
    return reply.status(429).send({
      error: 'Rate limit exceeded',
      retry_after: Math.ceil(result.resetMs / 1000),
    });
  }
}

export async function registerAuth(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url;

    // Public routes
    if (url.startsWith('/v1/auth/') || url === '/health') {
      return;
    }

    // API key auth for TTS routes
    if (url.startsWith('/v1/tts')) {
      await requireApiKeyAuth(request, reply);
      if (reply.sent) return;
      return requireRateLimit(request, reply);
    }

    // JWT auth for account/dashboard routes
    if (
      url.startsWith('/v1/api-keys') ||
      url.startsWith('/v1/usage') ||
      url.startsWith('/v1/billing')
    ) {
      return requireJwtAuth(request, reply);
    }
  });
}
