import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from './db.js';

const API_KEY_PREFIX = process.env.API_KEY_PREFIX ?? 'ws_';
const BCRYPT_ROUNDS = 12;

export function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${API_KEY_PREFIX}${randomBytes}`;
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

export async function verifyApiKey(key: string) {
  if (!key.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const apiKeys = await db
    .selectFrom('api_keys')
    .where('revoked_at', 'is', null)
    .select(['id', 'user_id', 'key_hash'])
    .execute();

  for (const apiKey of apiKeys) {
    const match = await bcrypt.compare(key, apiKey.key_hash);
    if (match) {
      return {
        id: apiKey.id,
        userId: apiKey.user_id,
      };
    }
  }

  return null;
}
