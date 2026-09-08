import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrCoordinator } from '@/lib/authz';
import { consumeLimit, geocodeLimiter } from '@/lib/rateLimit';

export const runtime = 'nodejs';

// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application (no generic browser UA) — NOMINATIM_CONTACT_EMAIL is optional,
// set it to an organizational contact address if stricter compliance is needed.
const NOMINATIM_USER_AGENT = `FundacjaQ-CrisisMap/1.0${
  process.env.NOMINATIM_CONTACT_EMAIL ? ` (${process.env.NOMINATIM_CONTACT_EMAIL})` : ''
}`;

interface NominatimAddress {
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

  let data: { address?: NominatimAddress; display_name?: string };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, 'Accept-Language': 'pl' },
    });
    if (!res.ok) throw new Error(`Nominatim responded with ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('[geocode] reverse lookup failed:', err);
    return NextResponse.json({ error: 'Nie udało się rozpoznać lokalizacji.' }, { status: 502 });
  }

  const address = data.address ?? {};
  const road = address.road ?? address.pedestrian ?? address.footway ?? null;
  const town = address.city ?? address.town ?? address.village ?? address.municipality ?? null;

  return NextResponse.json({
    location: road ? `${road}${address.house_number ? ` ${address.house_number}` : ''}` : null,
    town,
    county: address.county ?? null,
    state: address.state ?? null,
  });
}
