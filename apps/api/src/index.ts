import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type ZodTypeProvider,
  validatorCompiler,
  serializerCompiler,
} from '@fastify/type-provider-zod';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { registerAuth } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { ttsRoutes } from './routes/tts.js';
import { usageRoutes } from './routes/usage.js';
import { billingRoutes } from './routes/billing.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
  bodyLimit: 1024 * 1024, // 1MB
}).withTypeProvider<ZodTypeProvider>();

// Preserve raw body for Stripe webhook signature verification
app.addHook('preSerialization', async (request) => {
  if (request.url === '/v1/billing/webhook' && request.body) {
    (request as FastifyRequest & { rawBody?: string }).rawBody = JSON.stringify(
      request.body,
    );
  }
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await registerAuth(app);
await app.register(authRoutes);
await app.register(apiKeyRoutes);
await app.register(ttsRoutes);
await app.register(usageRoutes);
await app.register(billingRoutes);

const AUDIO_DIR = process.env.AUDIO_DIR ?? './audio';
await app.register(fastifyStatic, {
  root: path.resolve(AUDIO_DIR),
  prefix: '/audio/',
  decorateReply: false,
});

const HealthResponse = z.object({
  status: z.string(),
});

app.get(
  '/health',
  {
    schema: {
      response: {
        200: HealthResponse,
      },
    },
  },
  async () => {
    return { status: 'ok' };
  },
);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

async function start() {
  try {
    await app.listen({ port, host });
    app.log.info(`API listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    process.exit(0);
  });
}

process.on('unhandledRejection', (err) => {
  app.log.error(err, 'Unhandled rejection');
});

start();
