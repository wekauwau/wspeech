import Fastify from 'fastify';
import { z } from 'zod';
import {
  type ZodTypeProvider,
  validatorCompiler,
  serializerCompiler,
} from '@fastify/type-provider-zod';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

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

start();
