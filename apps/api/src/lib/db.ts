import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '@wspeech/shared';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool,
  }),
});
