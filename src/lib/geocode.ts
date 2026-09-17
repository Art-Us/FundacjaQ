// Wspólna warstwa dla obu kierunków geokodowania (reverse: klik na mapie →
// adres, search: wpisany adres → współrzędne). Trzyma w jednym miejscu politykę
// Nominatim, nastawienie na gminę pilotażową i formatowanie etykiety, żeby oba
// endpointy nie rozjechały się w szczegółach.

// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application (no generic browser UA) — NOMINATIM_CONTACT_EMAIL is optional,
// set it to an organizational contact address if stricter compliance is needed.
export const NOMINATIM_USER_AGENT = `FundacjaQ-CrisisMap/1.0${
  process.env.NOMINATIM_CONTACT_EMAIL ? ` (${process.env.NOMINATIM_CONTACT_EMAIL})` : ''
}`;

// Zakres pilotażowy projektu to gmina Nowa Dęba, więc wyszukiwanie adresów ma
// ją traktować priorytetowo: najpierw szukamy ulicy wyłącznie w tej gminie
// (zapytanie strukturalne), a dopiero potem szerzej z `viewbox` jako miękkim
// nastawieniem. `viewbox` to dwa narożniki ramki w formacie lon,lat,lon,lat.
export const GEOCODE_BIAS = {
  city: 'Nowa Dęba',
  county: 'powiat tarnobrzeski',
  state: 'podkarpackie',
  country: 'Polska',
  countryCodes: 'pl',
  viewbox: '21.58,50.31,21.94,50.52',
} as const;

// Nominatim w zapytaniu strukturalnym (`street=`) oczekuje samej nazwy ulicy
// (opcjonalnie z numerem), bez polskiego określnika typu. Z "ul. Kościuszki"
// nie znajdował nic i wyszukiwanie spadało do szerokiego fallbacku, który
// trafiał w losowe miasto — dlatego prefiks ucinamy przed zapytaniem.
const STREET_PREFIX = /^(ul\.?|ulica|al\.?|aleja|pl\.?|plac|os\.?|osiedle)\s+/i;

export function normalizeStreetQuery(query: string): string {
  return query.replace(STREET_PREFIX, '').trim();
}

export interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  house_number?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
}

export interface NominatimPlace {
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
  display_name?: string;
}

export interface ResolvedLocation {
  /** Ulica z numerem — trafia do pola „Lokalizacja" w formularzu. */
  location: string | null;
  town: string | null;
  county: string | null;
  state: string | null;
  /** Gotowa etykieta do wyświetlenia w UI (już bez zdublowanych prefiksów). */
  label: string | null;
}

export async function fetchNominatim(url: URL): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT, 'Accept-Language': 'pl' },
  });
  if (!res.ok) throw new Error(`Nominatim responded with ${res.status}`);
  return res.json();
}

// Nominatim zwraca dla Polski nazwy z pełnymi prefiksami ("województwo
// podkarpackie", "powiat tarnobrzeski"). Dokładanie do nich własnego skrótu
// dawało wcześniej "woj. województwo podkarpackie" — dlatego prefiks najpierw
// ucinamy, a potem dokładamy jeden, spójny.
function formatState(state: string | null): string | null {
  if (!state) return null;
  const bare = state.replace(/^województwo\s+/i, '').trim();
  return bare ? `woj. ${bare}` : null;
}

function formatCounty(county: string | null): string | null {
  if (!county) return null;
  const trimmed = county.trim();
  if (!trimmed) return null;
  return /^powiat\s+/i.test(trimmed) ? trimmed : `powiat ${trimmed}`;
}

// Odwrotność formatState/formatCounty: Gmina.powiat/voivodeship (i pola
// formularza gminy) trzymają same nazwy, bez prefiksów "powiat"/"województwo"
// — w przeciwieństwie do `label`, który je celowo dokłada do wyświetlenia.
export function bareState(state: string | null): string | null {
  if (!state) return null;
  const bare = state.replace(/^województwo\s+/i, '').trim();
  return bare || null;
}

export function bareCounty(county: string | null): string | null {
  if (!county) return null;
  const bare = county.replace(/^powiat\s+/i, '').trim();
  return bare || null;
}

export function resolveLocation(address: NominatimAddress): ResolvedLocation {
  const road = address.road ?? address.pedestrian ?? address.footway ?? null;
  const town = address.city ?? address.town ?? address.village ?? address.municipality ?? null;
  const county = address.county ?? null;
  const state = address.state ?? null;

  const street = road ? `${road}${address.house_number ? ` ${address.house_number}` : ''}` : null;

  // Powiat pomijamy, gdy powtarza nazwę miejscowości (np. miasta na prawach
  // powiatu), żeby etykieta nie brzmiała "Tarnobrzeg, powiat Tarnobrzeg".
  const countyLabel = formatCounty(county);
  const skipCounty =
    !countyLabel || (town ? countyLabel.toLowerCase().includes(town.toLowerCase()) : false);

  const parts = [street, town, skipCounty ? null : countyLabel, formatState(state)].filter(
    (part): part is string => !!part
  );

  return {
    location: street,
    town,
    county,
    state,
    label: parts.length > 0 ? parts.join(', ') : null,
  };
}
