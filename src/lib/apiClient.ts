// The single way client components call this app's own API.
//
// The hand-rolled pattern this replaces looked the same in ~20 places:
//
//   setLoading(true);
//   const res = await fetch(url, init);
//   const data = await res.json();   // throws on a non-JSON body
//   setLoading(false);               // never runs if it did
//   if (!res.ok) { setError(data.error); return; }
//
// Two failure modes fell straight through it. A route that throws before it
// can answer (or a dev-server restart, or a proxy) replies 500 with an HTML or
// empty body, so `res.json()` rejects; and a dropped connection makes `fetch`
// itself reject. Either way the rejection escaped an async event handler
// unhandled — which React error boundaries do NOT catch, since they only see
// render-phase errors — leaving the button spinning forever with no message.
//
// So this never rejects: every outcome comes back as a value.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number | null };

const NETWORK_ERROR = 'Brak połączenia z serwerem. Sprawdź połączenie i spróbuj ponownie.';
const FALLBACK_ERROR = 'Coś poszło nie tak.';

export async function apiFetch<T = unknown>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    // `status: null` is what distinguishes "the request never landed" from a
    // real HTTP failure, for callers that want to say so.
    return { ok: false, error: NETWORK_ERROR, status: null };
  }

  // Parsed only after the status is known, and never allowed to throw: on an
  // error response the body is as likely to be Next's HTML 500 page as it is
  // to be our own `{ error }`.
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;

  if (!res.ok) {
    const message =
      typeof body?.error === 'string' && body.error.trim().length > 0
        ? body.error
        : `${FALLBACK_ERROR} (HTTP ${res.status})`;
    return { ok: false, error: message, status: res.status };
  }

  return { ok: true, data: (body ?? {}) as T };
}

// Same contract, for the POST/PATCH majority that send a JSON body — the
// Content-Type header and JSON.stringify were copy-pasted at every one of
// those call sites, and a forgotten header is a silent 400 from zod.
export function apiSend<T = unknown>(
  input: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<ApiResult<T>> {
  return apiFetch<T>(input, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
}
