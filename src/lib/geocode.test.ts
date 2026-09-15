import { describe, expect, it } from 'vitest';
import { resolveLocation, normalizeStreetQuery } from './geocode';

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
