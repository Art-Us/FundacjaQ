import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { consumeLimit, geocodeLimiter } from '@/lib/rateLimit';
import {
  fetchNominatim,
  resolveLocation,
  normalizeStreetQuery,
  GEOCODE_BIAS,
  type NominatimPlace,
} from '@/lib/geocode';

export const runtime = 'nodejs';

const MIN_QUERY_LENGTH = 3;

function baseUrl(): URL {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  return url;
}

// Krok 1 — zapytanie strukturalne ograniczone do gminy pilotażowej. To ono daje
// gminie Nowa Dęba priorytet: wpisana ulica jest szukana najpierw wyłącznie tu.
function gminaScopedUrl(query: string): URL {
  const url = baseUrl();
  url.searchParams.set('street', normalizeStreetQuery(query));
  url.searchParams.set('city', GEOCODE_BIAS.city);
  url.searchParams.set('county', GEOCODE_BIAS.county);
  url.searchParams.set('state', GEOCODE_BIAS.state);
  url.searchParams.set('country', GEOCODE_BIAS.country);
  return url;
}

// Krok 2 — nadal w gminie, ale zapytaniem swobodnym: łapie to, co nie jest
// ulicą (obiekty, osiedla, przysiółki), a czego krok 1 z definicji nie znajdzie.
function gminaFreeFormUrl(query: string): URL {
  const url = baseUrl();
  url.searchParams.set('q', `${query}, ${GEOCODE_BIAS.city}, ${GEOCODE_BIAS.county}`);
  url.searchParams.set('countrycodes', GEOCODE_BIAS.countryCodes);
  return url;
}

// Krok 3 — ostatnia deska ratunku dla adresów spoza gminy: cała Polska, z
// `viewbox` wokół gminy jako miękkim nastawieniem. Kroki są sekwencyjne i
// przerywane po pierwszym trafieniu, więc typowe lokalne szukanie kończy się
// na kroku 1 — to trzymanie się limitu ~1 zapytania/s, jaki Nominatim nakłada
// na całą aplikację (patrz geocodeLimiter).
function countryWideUrl(query: string): URL {
  const url = baseUrl();
  url.searchParams.set('q', query);
  url.searchParams.set('countrycodes', GEOCODE_BIAS.countryCodes);
  url.searchParams.set('viewbox', GEOCODE_BIAS.viewbox);
  return url;
}

export async function GET(req: NextRequest) {
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  // Fixed key, not user.id — Nominatim's ~1 req/s cap is per-app, not
  // per-user (see geocodeLimiter's own comment in lib/rateLimit.ts).
  const allowed = await consumeLimit(geocodeLimiter, 'global');
  if (!allowed) {
    return NextResponse.json({ error: 'Zbyt wiele żądań, spróbuj za chwilę.' }, { status: 429 });
  }

  const query = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ error: 'Zapytanie jest za krótkie.' }, { status: 400 });
  }

  let place: NominatimPlace | undefined;
  try {
    for (const url of [gminaScopedUrl(query), gminaFreeFormUrl(query), countryWideUrl(query)]) {
      const results = (await fetchNominatim(url)) as NominatimPlace[];
      if (Array.isArray(results) && results.length > 0) {
        place = results[0];
        break;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Wyszukiwanie adresu trwa zbyt długo.' }, { status: 504 });
    }
    console.error('[geocode] forward search failed:', err);
    return NextResponse.json({ error: 'Nie udało się wyszukać adresu.' }, { status: 502 });
  }

  const lat = Number(place?.lat);
  const lon = Number(place?.lon);
  if (!place || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({ found: true, lat, lon, ...resolveLocation(place.address ?? {}) });
}
