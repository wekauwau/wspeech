import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  sub: string;
  email: string;
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export async function authenticateJwt(token: string) {
  const decoded = verifyJwt(token);
  const user = await db
    .selectFrom('users')
    .where('id', '=', decoded.sub)
    .select(['id', 'email', 'created_at'])
    .executeTakeFirst();

  if (!user) {
    throw new Error('User not found');
  }

  return user;
}
