import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { consumeLimit, geocodeLimiter } from '@/lib/rateLimit';
import { fetchNominatim, resolveLocation, type NominatimPlace } from '@/lib/geocode';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Gated the same as alert creation — this endpoint only feeds AlertForm's
  // location picker, so nobody else has a reason to call it.
  const user = await requireAdminOrCoordinator();
  if (!user) {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const allowed = await consumeLimit(geocodeLimiter, user.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Zbyt wiele żądań, spróbuj za chwilę.' }, { status: 429 });
  }

  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lon = Number(req.nextUrl.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Nieprawidłowe współrzędne.' }, { status: 400 });
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  let data: NominatimPlace;
  try {
    data = (await fetchNominatim(url)) as NominatimPlace;
  } catch (err) {
    console.error('[geocode] reverse lookup failed:', err);
    return NextResponse.json({ error: 'Nie udało się rozpoznać lokalizacji.' }, { status: 502 });
  }

  return NextResponse.json(resolveLocation(data.address ?? {}));
}
