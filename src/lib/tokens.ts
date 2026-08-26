import { randomBytes, createHash } from 'crypto';

export const INVITE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48h
export const INVITE_TOKEN_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // hard cap: 7 days
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
