import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { z } from 'zod';

const BCRYPT_COST = 12;

// NIST 800-63B: favor length over forced complexity rules.
export const passwordSchema = z
  .string()
  .min(12, 'Hasło musi mieć co najmniej 12 znaków')
  .max(128, 'Hasło jest za długie');

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Computed once at startup so a login for a nonexistent email still pays the
// full bcrypt cost — otherwise the missing user short-circuits verifyPassword
// and the response time itself reveals whether the account exists.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-attack-mitigation', BCRYPT_COST);

/**
 * Checks the password against the HIBP k-Anonymity range API without ever
 * sending the full password or its full hash. Fails open (returns false,
 * i.e. "not known to be pwned") on any network error/timeout so a
 * third-party outage never blocks account provisioning.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[password] HIBP range API returned ${res.status}, allowing password through`);
      return false;
    }

    const body = await res.text();
    return body.split('\n').some((line) => line.trim().toUpperCase().startsWith(suffix));
  } catch (err) {
    console.warn('[password] HIBP breach check failed, failing open:', err);
    return false;
  }
}
