import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { generateApiKey, hashApiKey } from '../lib/api-key.js';

const CreateApiKeyBody = z.object({
  label: z.string().min(1).max(100),
});

type CreateApiKeyBody = z.infer<typeof CreateApiKeyBody>;

const ApiKeyParams = z.object({
  id: z.string().uuid(),
});

type ApiKeyParams = z.infer<typeof ApiKeyParams>;

export async function apiKeyRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateApiKeyBody }>(
    '/v1/api-keys',
    {
      schema: {
        body: CreateApiKeyBody,
        response: {
          201: z.object({
            id: z.string(),
            key: z.string(),
            label: z.string(),
            created_at: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { label } = request.body;
      const userId = request.authUser!.id;

      const rawKey = generateApiKey();
      const keyHash = await hashApiKey(rawKey);

      const apiKey = await db
        .insertInto('api_keys')
        .values({
          user_id: userId,
          key_hash: keyHash,
          label,
        })
        .returning(['id', 'label', 'created_at'])
        .executeTakeFirstOrThrow();

      return reply.status(201).send({
        id: apiKey.id,
        key: rawKey,
        label: apiKey.label,
        created_at: apiKey.created_at.toISOString(),
      });
    },
  );

  app.delete<{ Params: ApiKeyParams }>(
    '/v1/api-keys/:id',
    {
      schema: {
        params: ApiKeyParams,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.authUser!.id;

      const result = await db
        .updateTable('api_keys')
        .set({ revoked_at: new Date() })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      if (result.numUpdatedRows === 0n) {
        return reply.status(404).send({ error: 'API key not found' });
      }

      return reply.status(204).send();
    },
  );

  app.get(
    '/v1/api-keys',
    {
      schema: {
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              created_at: z.string(),
              revoked_at: z.string().nullable(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const userId = request.authUser!.id;

      const keys = await db
        .selectFrom('api_keys')
        .where('user_id', '=', userId)
        .select(['id', 'label', 'created_at', 'revoked_at'])
        .orderBy('created_at', 'desc')
        .execute();

      return keys.map((k) => ({
        id: k.id,
        label: k.label,
        created_at: k.created_at.toISOString(),
        revoked_at: k.revoked_at?.toISOString() ?? null,
      }));
    },
  );
}
