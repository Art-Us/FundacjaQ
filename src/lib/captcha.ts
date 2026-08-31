const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Verifies a Google reCAPTCHA v2 token server-side. Fails closed (returns
 * false) on a missing token or a broken verification request — unlike the
 * HIBP password check, this gate only ever engages after suspicious volume,
 * so silently letting requests through on a Google outage would defeat its
 * purpose. When RECAPTCHA_SECRET_KEY isn't configured, the check is a no-op
 * (mirrors the email.ts stub pattern: works out of the box, becomes real
 * once credentials are set).
 */
export async function verifyCaptcha(token: string | null | undefined, remoteIp: string): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.warn('[captcha] RECAPTCHA_SECRET_KEY not configured — allowing request through. Set it before production.');
    return true;
  }

  if (!token) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;

    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error('[captcha] verification request failed:', err);
    return false;
  }
}