import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { db } from '../lib/db.js';
import { signJwt } from '../lib/jwt.js';

const BCRYPT_ROUNDS = 12;

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type RegisterBody = z.infer<typeof RegisterBody>;

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
});

type LoginBody = z.infer<typeof LoginBody>;

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>(
    '/v1/auth/register',
    {
      schema: {
        body: RegisterBody,
        response: {
          201: z.object({
            id: z.string(),
            email: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const existing = await db
        .selectFrom('users')
        .where('email', '=', email)
        .select('id')
        .executeTakeFirst();

      if (existing) {
        return reply.status(409).send({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const user = await db
        .insertInto('users')
        .values({
          email,
          password_hash: passwordHash,
        })
        .returning(['id', 'email'])
        .executeTakeFirstOrThrow();

      return reply.status(201).send({
        id: user.id,
        email: user.email,
      });
    },
  );

  app.post<{ Body: LoginBody }>(
    '/v1/auth/login',
    {
      schema: {
        body: LoginBody,
        response: {
          200: z.object({
            jwt: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await db
        .selectFrom('users')
        .where('email', '=', email)
        .select(['id', 'email', 'password_hash'])
        .executeTakeFirst();

      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = signJwt({ sub: user.id, email: user.email });

      return reply.send({ jwt: token });
    },
  );
}
