import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveLocation, normalizeStreetQuery, fetchNominatim } from './geocode';

describe('normalizeStreetQuery', () => {
  it.each([
    ['ul. Kościuszki', 'Kościuszki'],
    ['ul Kościuszki', 'Kościuszki'],
    ['ulica Sportowa', 'Sportowa'],
    ['al. Niepodległości', 'Niepodległości'],
    ['pl. Wolności', 'Wolności'],
    ['os. Zachodnie', 'Zachodnie'],
    ['osiedle Poligon', 'Poligon'],
  ])('ucina określnik typu ulicy: %s', (input, expected) => {
    expect(normalizeStreetQuery(input)).toBe(expected);
  });

  it('zostawia nazwę bez określnika bez zmian', () => {
    expect(normalizeStreetQuery('Rzeczna 12')).toBe('Rzeczna 12');
  });

  it('nie ucina nazw, które tylko zaczynają się podobnie', () => {
    expect(normalizeStreetQuery('Ulanowska')).toBe('Ulanowska');
    expect(normalizeStreetQuery('Placowa')).toBe('Placowa');
  });
});

describe('resolveLocation', () => {
  it('skraca polskie prefiksy zamiast je dublować', () => {
    const { label } = resolveLocation({
      road: 'Rzeczna',
      house_number: '12',
      town: 'Nowa Dęba',
      county: 'powiat tarnobrzeski',
      state: 'województwo podkarpackie',
    });

    // Regresja: wcześniej klient dokładał własne "woj." do pełnej nazwy
    // z Nominatim i wychodziło "woj. województwo podkarpackie".
    expect(label).toBe('Rzeczna 12, Nowa Dęba, powiat tarnobrzeski, woj. podkarpackie');
    expect(label).not.toContain('województwo podkarpackie');
  });

  it('dokłada brakujący prefiks powiatu', () => {
    const { label } = resolveLocation({ village: 'Chmielów', county: 'tarnobrzeski' });
    expect(label).toBe('Chmielów, powiat tarnobrzeski');
  });

  it('pomija powiat powtarzający nazwę miejscowości', () => {
    const { label } = resolveLocation({
      city: 'Tarnobrzeg',
      county: 'Tarnobrzeg',
      state: 'województwo podkarpackie',
    });
    expect(label).toBe('Tarnobrzeg, woj. podkarpackie');
  });

  it('składa ulicę z numerem do pola lokalizacji', () => {
    const resolved = resolveLocation({ pedestrian: 'Sportowa', house_number: '3', town: 'Nowa Dęba' });
    expect(resolved.location).toBe('Sportowa 3');
    expect(resolved.town).toBe('Nowa Dęba');
  });

  it('zwraca null gdy Nominatim nie zwrócił adresu', () => {
    const resolved = resolveLocation({});
    expect(resolved.location).toBeNull();
    expect(resolved.label).toBeNull();
  });
});

describe('fetchNominatim', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses and returns the JSON body of a successful response', async () => {
    const payload = { address: { road: 'Rzeczna' } };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
    } as any);

    const result = await fetchNominatim(new URL('https://nominatim.openstreetmap.org/reverse'));

    expect(result).toEqual(payload);
  });

  it('sends the Nominatim-required User-Agent and Accept-Language headers', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    } as any);

    const url = new URL('https://nominatim.openstreetmap.org/search');
    await fetchNominatim(url);

    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Accept-Language': 'pl' }),
      })
    );
    const call = vi.mocked(fetch).mock.calls[0][1] as any;
    expect(call.headers['User-Agent']).toContain('FundacjaQ-CrisisMap');
  });

  it('throws when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    } as any);

    await expect(fetchNominatim(new URL('https://nominatim.openstreetmap.org/reverse'))).rejects.toThrow(
      'Nominatim responded with 503'
    );
  });

  it('propagates a network-level rejection', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    await expect(fetchNominatim(new URL('https://nominatim.openstreetmap.org/reverse'))).rejects.toThrow(
      'network down'
    );
  });
});
