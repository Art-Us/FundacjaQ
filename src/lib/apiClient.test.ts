import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch, apiSend } from './apiClient';

function mockFetch(impl: () => Promise<unknown> | never) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

// A 500 from a route that threw before answering: Next replies with an HTML
// page or nothing at all, so json() rejects.
function nonJsonResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(async () => jsonResponse(200, { entries: [1, 2] }));

    const result = await apiFetch<{ entries: number[] }>('/api/x');

    expect(result).toEqual({ ok: true, data: { entries: [1, 2] } });
  });

  it("surfaces the route's own error message on a failure response", async () => {
    mockFetch(async () => jsonResponse(409, { error: 'Nie można usunąć zapotrzebowania.' }));

    const result = await apiFetch('/api/x');

    expect(result).toEqual({ ok: false, error: 'Nie można usunąć zapotrzebowania.', status: 409 });
  });

  // The whole point: this used to throw out of an async event handler.
  it('does not reject when the error body is not JSON', async () => {
    mockFetch(async () => nonJsonResponse(500));

    const result = await apiFetch('/api/x');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toContain('HTTP 500');
    }
  });

  it('reports a dropped connection as status null rather than rejecting', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const result = await apiFetch('/api/x');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeNull();
      expect(result.error).toContain('połączenia');
    }
  });

  it('falls back when the body carries a blank or non-string error', async () => {
    mockFetch(async () => jsonResponse(400, { error: '   ' }));

    const result = await apiFetch('/api/x');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('HTTP 400');
  });

  it('treats a bodyless success (204) as an empty object', async () => {
    mockFetch(
      async () =>
        ({
          ok: true,
          status: 204,
          json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
          },
        }) as unknown as Response
    );

    const result = await apiFetch('/api/x');

    expect(result).toEqual({ ok: true, data: {} });
  });
});

describe('apiSend', () => {
  it('sets the JSON content type and serializes the body', async () => {
    const spy = vi.fn(async () => jsonResponse(201, { need: { id: 'n1' } }));
    vi.stubGlobal('fetch', spy);

    const result = await apiSend('/api/needs', 'POST', { title: 'Koce' });

    expect(result).toEqual({ ok: true, data: { need: { id: 'n1' } } });
    expect(spy).toHaveBeenCalledWith('/api/needs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Koce' }),
    });
  });

  it('sends no body or content type when none is given', async () => {
    const spy = vi.fn(async () => jsonResponse(200, { message: 'ok' }));
    vi.stubGlobal('fetch', spy);

    await apiSend('/api/needs/n1', 'DELETE');

    expect(spy).toHaveBeenCalledWith('/api/needs/n1', { method: 'DELETE' });
  });
});
