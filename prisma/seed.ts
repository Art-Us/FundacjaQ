import { PrismaClient, Role, Severity, AlertStatus, ResourceStatus, ResourceHorizon } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

const TEST_PASSWORD = 'Test1234!';

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('ℹ️  Pomijam tworzenie konta admina: ustaw ADMIN_EMAIL i ADMIN_PASSWORD, aby je utworzyć.');
    return;
  }

  const passwordHash = await hashPassword(password);
  // ADMIN is site-wide (not tied to one gmina), so gminaId stays unset — and
  // since Organization.gminaId is required, an ADMIN account has nothing to
  // scope an organization to either, so organizationId stays unset too.
  // Every other field is filled in so the account renders fully on admin/users.
  const data = {
    name: 'Administrator Systemu',
    phone: '+48 600 000 000',
    passwordHash,
    role: 'ADMIN' as const,
    isActive: true,
    lastActivatedAt: daysAgo(120),
    emailVerified: daysAgo(120),
  };

  await prisma.user.upsert({
    where: { email },
    update: data,
    create: { email, ...data },
  });

  console.log(`🌱 Konto admina gotowe: ${email}`);
}

async function seedGminy() {
  const gminy = [
    { name: 'Gmina Nowa Dęba', powiat: 'tarnobrzeski', voivodeship: 'podkarpackie', contactEmail: 'kryzys@nowadeba.pl', latitude: 50.4166, longitude: 21.7500 },
  ];

  const created = [];
  for (const g of gminy) {
    created.push(await prisma.gmina.upsert({ where: { name: g.name }, update: g, create: g }));
  }
  return created;
}

async function seedKategorie() {
  const kategorie = [
    { name: 'Żywność', icon: '🍞', group: 'OTHER' as const },
    { name: 'Woda pitna', icon: '💧', group: 'WATER' as const },
    { name: 'Koce i odzież', icon: '🧣', group: 'OTHER' as const },
    { name: 'Sprzęt medyczny', icon: '🩹', group: 'EQUIPMENT' as const },
    { name: 'Agregaty prądotwórcze', icon: '🔌', group: 'EQUIPMENT' as const },
    { name: 'Ludzie / Wolontariusze', icon: '🧑‍🤝‍🧑', group: 'PEOPLE' as const },

    // Dodatkowe, bardziej szczegółowe podkategorie — plus jedna kategoria
    // "catch-all" na grupę (Inny sprzęt / Inne materiały), która działa jako
    // domyślna dla opcji "➕ Własna nazwa zasobu…" w ResourceFormModal.tsx
    // (patrz GROUP_FALLBACK_CATEGORY_NAME tam). PEOPLE i WATER mają już
    // swoją "catch-all" kategorię (Ludzie / Wolontariusze, Woda pitna).
    { name: 'Psycholodzy i wsparcie kryzysowe', icon: '🧠', group: 'PEOPLE' as const },
    { name: 'Ratownicy medyczni i lekarze', icon: '⚕️', group: 'PEOPLE' as const },
    { name: 'Wolontariusze do segregacji i dystrybucji', icon: '📦', group: 'PEOPLE' as const },

    { name: 'Systemy uzdatniania wody', icon: '🧪', group: 'WATER' as const },
    { name: 'Zbiorniki i cysterny na wodę', icon: '🛢️', group: 'WATER' as const },

    { name: 'Inny sprzęt', icon: '🧰', group: 'EQUIPMENT' as const },
    { name: 'Sprzęt ratownictwa technicznego', icon: '🛠️', group: 'EQUIPMENT' as const },
    { name: 'Łodzie i sprzęt pływający', icon: '🚤', group: 'EQUIPMENT' as const },

    { name: 'Inne materiały', icon: '📋', group: 'OTHER' as const },
    { name: 'Środki czystości i higieny', icon: '🧴', group: 'OTHER' as const },
    { name: 'Materiały budowlane i naprawcze', icon: '🧱', group: 'OTHER' as const },
  ];

  const created = [];
  for (const k of kategorie) {
    created.push(await prisma.resourceCategory.upsert({ where: { name: k.name }, update: k, create: k }));
  }
  return created;
}

async function seedOrganizacje(gminy: Awaited<ReturnType<typeof seedGminy>>) {
  const organizacje = [
    { name: 'Ochotnicza Straż Pożarna Nowa Dęba', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 111 222', contactEmail: 'osp@nowadeba.pl' },
    { name: 'Caritas Diecezji Sandomierskiej', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 333 444', contactEmail: 'caritas@nowadeba.pl' },
    { name: 'Polski Czerwony Krzyż Oddział Nowa Dęba', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 555 111', contactEmail: 'pck@nowadeba.pl' },
    { name: 'Wodne Ochotnicze Pogotowie Ratunkowe Nowa Dęba', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 555 222', contactEmail: 'wopr@nowadeba.pl' },
    { name: 'Koło Gospodyń Wiejskich "Dębianki"', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 555 333', contactEmail: 'kgw.debianki@nowadeba.pl' },
    { name: 'Stowarzyszenie "Razem dla Nowej Dęby"', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 555 444', contactEmail: 'razem@nowadeba.pl' },
    { name: 'Nadleśnictwo Nowa Dęba', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 555 555', contactEmail: 'nadlesnictwo@nowadeba.pl' },
    { name: 'Miejski Ośrodek Pomocy Społecznej w Nowej Dębie', city: 'Nowa Dęba', gminaId: gminy[0].id, contactPhone: '+48 601 555 666', contactEmail: 'mops@nowadeba.pl' },
    { name: 'Ochotnicza Straż Pożarna Cygany', city: 'Cygany', gminaId: gminy[0].id, contactPhone: '+48 601 555 777', contactEmail: 'osp.cygany@nowadeba.pl' },
  ];

  const created: Record<string, Awaited<ReturnType<typeof prisma.organization.upsert>>> = {};
  for (const o of organizacje) {
    created[o.name] = await prisma.organization.upsert({
      where: { name_gminaId: { name: o.name, gminaId: o.gminaId } },
      update: o,
      create: o,
    });
  }
  return created;
}

async function seedTestUsers(gminy: Awaited<ReturnType<typeof seedGminy>>, organizacje: Awaited<ReturnType<typeof seedOrganizacje>>) {
  const users: Array<{
    email: string;
    name: string;
    role: Role;
    gminaId: string | null;
    organization: string;
    phone: string;
    isActive: boolean;
    lastActivatedAt: Date | null;
    lastDeactivatedAt: Date | null;
    deactivationReason: string | null;
  }> = [
    { email: 'koordynator@example.com', name: 'Katarzyna Nowak', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Ochotnicza Straż Pożarna Nowa Dęba', phone: '+48 602 100 200', isActive: true, lastActivatedAt: daysAgo(90), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'wolontariusz@example.com', name: 'Anna Wiśniewska', role: 'VOLUNTEER', gminaId: gminy[0].id, organization: 'Caritas Diecezji Sandomierskiej', phone: '+48 602 300 400', isActive: true, lastActivatedAt: daysAgo(60), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'wolontariusz2@example.com', name: 'Marek Zieliński', role: 'VOLUNTEER', gminaId: gminy[0].id, organization: 'Caritas Diecezji Sandomierskiej', phone: '+48 602 500 600', isActive: false, lastActivatedAt: daysAgo(60), lastDeactivatedAt: daysAgo(5), deactivationReason: 'Zakończenie współpracy' },
    // Jeden koordynator na każdą z 7 dodatkowych organizacji (seedZasoby poniżej
    // przypisuje im też własne zasoby) — żeby dropdown "Posiadacz" i macierz
    // zasobów na /zasoby miały realną różnorodność do przeglądania.
    { email: 'koordynator2@example.com', name: 'Beata Kowalczyk', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Polski Czerwony Krzyż Oddział Nowa Dęba', phone: '+48 602 700 100', isActive: true, lastActivatedAt: daysAgo(80), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'koordynator3@example.com', name: 'Piotr Wójcik', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Wodne Ochotnicze Pogotowie Ratunkowe Nowa Dęba', phone: '+48 602 700 200', isActive: true, lastActivatedAt: daysAgo(75), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'koordynator4@example.com', name: 'Grażyna Mazur', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Koło Gospodyń Wiejskich "Dębianki"', phone: '+48 602 700 300', isActive: true, lastActivatedAt: daysAgo(70), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'koordynator5@example.com', name: 'Tomasz Krawczyk', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Stowarzyszenie "Razem dla Nowej Dęby"', phone: '+48 602 700 400', isActive: true, lastActivatedAt: daysAgo(65), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'koordynator6@example.com', name: 'Adam Sikora', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Nadleśnictwo Nowa Dęba', phone: '+48 602 700 500', isActive: true, lastActivatedAt: daysAgo(60), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'koordynator7@example.com', name: 'Ewa Duda', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Miejski Ośrodek Pomocy Społecznej w Nowej Dębie', phone: '+48 602 700 600', isActive: true, lastActivatedAt: daysAgo(55), lastDeactivatedAt: null, deactivationReason: null },
    { email: 'koordynator8@example.com', name: 'Rafał Ostrowski', role: 'COORDINATOR', gminaId: gminy[0].id, organization: 'Ochotnicza Straż Pożarna Cygany', phone: '+48 602 700 700', isActive: true, lastActivatedAt: daysAgo(50), lastDeactivatedAt: null, deactivationReason: null },
  ];

  const passwordHash = await hashPassword(TEST_PASSWORD);

  for (const u of users) {
    const organization = organizacje[u.organization];
    if (!organization) {
      throw new Error(
        `seedTestUsers: no seeded organization named "${u.organization}" (check it matches a name in seedOrganizacje exactly).`
      );
    }

    const data = {
      name: u.name,
      role: u.role,
      gminaId: u.gminaId,
      organizationId: organization.id,
      phone: u.phone,
      passwordHash,
      isActive: u.isActive,
      lastActivatedAt: u.lastActivatedAt,
      lastDeactivatedAt: u.lastDeactivatedAt,
      deactivationReason: u.deactivationReason,
      emailVerified: daysAgo(90),
    };
    await prisma.user.upsert({
      where: { email: u.email },
      update: data,
      create: { email: u.email, ...data },
    });
  }

  console.log(`🌱 Konta testowe gotowe (hasło: ${TEST_PASSWORD}):`);
  users.forEach((u) => console.log(`   - ${u.email} [${u.role}]${u.isActive ? '' : ' (nieaktywne)'}`));
}

async function seedZasoby(
  gminy: Awaited<ReturnType<typeof seedGminy>>,
  kategorie: Awaited<ReturnType<typeof seedKategorie>>,
  organizacje: Awaited<ReturnType<typeof seedOrganizacje>>,
) {
  const byName = (name: string) => kategorie.find((k) => k.name === name)!;
  const osp = organizacje['Ochotnicza Straż Pożarna Nowa Dęba'].id;
  const caritas = organizacje['Caritas Diecezji Sandomierskiej'].id;
  const pck = organizacje['Polski Czerwony Krzyż Oddział Nowa Dęba'].id;
  const wopr = organizacje['Wodne Ochotnicze Pogotowie Ratunkowe Nowa Dęba'].id;
  const kgw = organizacje['Koło Gospodyń Wiejskich "Dębianki"'].id;
  const razem = organizacje['Stowarzyszenie "Razem dla Nowej Dęby"'].id;
  const nadlesnictwo = organizacje['Nadleśnictwo Nowa Dęba'].id;
  const mops = organizacje['Miejski Ośrodek Pomocy Społecznej w Nowej Dębie'].id;
  const ospCygany = organizacje['Ochotnicza Straż Pożarna Cygany'].id;

  const zasoby: Array<{
    name: string;
    description: string;
    quantity: number;
    unit: string;
    status: ResourceStatus;
    location: string;
    categoryId: string;
    gminaId: string;
    organizationId: string;
    horizon: ResourceHorizon;
  }> = [
    { name: 'Woda butelkowana 1.5L', description: 'Paletyzowana woda pitna', quantity: 4000, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn OSP Nowa Dęba', categoryId: byName('Woda pitna').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H24' },
    { name: 'Konserwy mięsne', description: 'Zapas żywności długoterminowej', quantity: 120, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn gminny', categoryId: byName('Żywność').id, gminaId: gminy[0].id, organizationId: caritas, horizon: 'H48' },
    { name: 'Koce termiczne', description: 'Koce ratunkowe NRC', quantity: 15, unit: 'szt', status: 'RESERVED', location: 'Punkt ewakuacyjny nr 2', categoryId: byName('Koce i odzież').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H24' },
    { name: 'Agregat prądotwórczy 5kW', description: 'Do zasilania punktu koordynacji', quantity: 2, unit: 'szt', status: 'IN_USE', location: 'Sztab kryzysowy', categoryId: byName('Agregaty prądotwórcze').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H24' },
    { name: 'Zestawy pierwszej pomocy', description: 'Apteczki R1', quantity: 0, unit: 'szt', status: 'DEPLETED', location: 'Magazyn OSP Nowa Dęba', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H24' },
    { name: 'Woda pitna w cysternach', description: '', quantity: 3, unit: 'm3', status: 'AVAILABLE', location: 'Baza transportowa', categoryId: byName('Woda pitna').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H48' },
    { name: 'Odzież zimowa', description: 'Kurtki i buty, różne rozmiary', quantity: 60, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn Caritas', categoryId: byName('Koce i odzież').id, gminaId: gminy[0].id, organizationId: caritas, horizon: 'WEEK' },
    { name: 'Żywność dla dzieci', description: 'Odżywki i słoiczki', quantity: 8, unit: 'kartony', status: 'RESERVED', location: 'Magazyn gminny', categoryId: byName('Żywność').id, gminaId: gminy[0].id, organizationId: caritas, horizon: 'H72' },
    { name: 'Agregat prądotwórczy 2kW', description: 'Przenośny', quantity: 5, unit: 'szt', status: 'AVAILABLE', location: 'Remiza OSP Nowa Dęba', categoryId: byName('Agregaty prądotwórcze').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H24' },
    { name: 'Nosze ratownicze', description: '', quantity: 4, unit: 'szt', status: 'IN_USE', location: 'Punkt medyczny', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[0].id, organizationId: osp, horizon: 'H24' },

    // 7 dodatkowych organizacji (patrz seedOrganizacje) — różne kategorie i
    // horyzonty, żeby macierz na /zasoby miała realną różnorodność zamiast
    // dwóch organizacji i pustej kolumny "Ludzie".
    { name: 'Zestawy pierwszej pomocy PCK', description: 'Apteczki R1 do dystrybucji', quantity: 25, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn PCK Nowa Dęba', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[0].id, organizationId: pck, horizon: 'H48' },
    { name: 'Koce ratunkowe PCK', description: 'Koce NRC do wydania poszkodowanym', quantity: 40, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn PCK Nowa Dęba', categoryId: byName('Koce i odzież').id, gminaId: gminy[0].id, organizationId: pck, horizon: 'H24' },
    { name: 'Wolontariusze przeszkoleni medycznie', description: 'Gotowi do wsparcia punktów medycznych', quantity: 12, unit: 'osób', status: 'AVAILABLE', location: 'Baza PCK Nowa Dęba', categoryId: byName('Ludzie / Wolontariusze').id, gminaId: gminy[0].id, organizationId: pck, horizon: 'H24' },

    { name: 'Ratownicy wodni WOPR', description: 'Gotowi do akcji na zbiornikach wodnych', quantity: 8, unit: 'osób', status: 'AVAILABLE', location: 'Baza WOPR Nowa Dęba', categoryId: byName('Ludzie / Wolontariusze').id, gminaId: gminy[0].id, organizationId: wopr, horizon: 'H24' },
    { name: 'Sprzęt do reanimacji (AED)', description: 'Defibrylatory przenośne', quantity: 3, unit: 'szt', status: 'AVAILABLE', location: 'Baza WOPR Nowa Dęba', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[0].id, organizationId: wopr, horizon: 'H72' },

    { name: 'Przetwory i konserwy domowe', description: 'Zapasy przygotowane przez KGW', quantity: 200, unit: 'słoiki', status: 'AVAILABLE', location: 'Świetlica wiejska', categoryId: byName('Żywność').id, gminaId: gminy[0].id, organizationId: kgw, horizon: 'WEEK' },
    { name: 'Wolontariuszki do przygotowywania posiłków', description: 'Gotowe do pracy w punkcie żywieniowym', quantity: 15, unit: 'osób', status: 'AVAILABLE', location: 'Świetlica wiejska', categoryId: byName('Ludzie / Wolontariusze').id, gminaId: gminy[0].id, organizationId: kgw, horizon: 'H48' },

    { name: 'Odzież używana', description: 'Zbiórka od mieszkańców, posortowana', quantity: 90, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn stowarzyszenia', categoryId: byName('Koce i odzież').id, gminaId: gminy[0].id, organizationId: razem, horizon: 'WEEK' },
    { name: 'Agregat prądotwórczy 3kW', description: 'Do wypożyczenia w razie potrzeby', quantity: 1, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn stowarzyszenia', categoryId: byName('Agregaty prądotwórcze').id, gminaId: gminy[0].id, organizationId: razem, horizon: 'H72' },

    { name: 'Strażnicy leśni gotowi do pomocy', description: 'Wsparcie przy pożarach lasu i poszycia', quantity: 6, unit: 'osób', status: 'AVAILABLE', location: 'Nadleśnictwo Nowa Dęba', categoryId: byName('Ludzie / Wolontariusze').id, gminaId: gminy[0].id, organizationId: nadlesnictwo, horizon: 'H24' },
    { name: 'Piły mechaniczne i agregaty leśne', description: 'Do usuwania powalonych drzew', quantity: 4, unit: 'szt', status: 'AVAILABLE', location: 'Nadleśnictwo Nowa Dęba', categoryId: byName('Agregaty prądotwórcze').id, gminaId: gminy[0].id, organizationId: nadlesnictwo, horizon: 'H24' },

    { name: 'Paczki żywnościowe', description: 'Dla rodzin poszkodowanych', quantity: 150, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn MOPS', categoryId: byName('Żywność').id, gminaId: gminy[0].id, organizationId: mops, horizon: 'H48' },
    { name: 'Odzież dla poszkodowanych', description: 'Nowa i używana, różne rozmiary', quantity: 70, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn MOPS', categoryId: byName('Koce i odzież').id, gminaId: gminy[0].id, organizationId: mops, horizon: 'H72' },

    { name: 'Woda butelkowana 0.5L', description: 'Zapas na wypadek awarii wodociągu', quantity: 1200, unit: 'szt', status: 'AVAILABLE', location: 'Remiza OSP Cygany', categoryId: byName('Woda pitna').id, gminaId: gminy[0].id, organizationId: ospCygany, horizon: 'H24' },
    { name: 'Nosze i apteczki OSP Cygany', description: '', quantity: 6, unit: 'szt', status: 'AVAILABLE', location: 'Remiza OSP Cygany', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[0].id, organizationId: ospCygany, horizon: 'H24' },
    { name: 'Strażacy ochotnicy OSP Cygany', description: 'Gotowi do wyjazdu', quantity: 10, unit: 'osób', status: 'AVAILABLE', location: 'Remiza OSP Cygany', categoryId: byName('Ludzie / Wolontariusze').id, gminaId: gminy[0].id, organizationId: ospCygany, horizon: 'H24' },
  ];

  await prisma.resource.deleteMany({ where: { gminaId: { in: gminy.map((g) => g.id) } } });
  await prisma.resource.createMany({ data: zasoby });
}

async function seedAlerty(
  gminy: Awaited<ReturnType<typeof seedGminy>>,
  adminId: string | null,
  koordynatorId: string | null,
  organizacje: Awaited<ReturnType<typeof seedOrganizacje>>,
) {
  const teraz = Date.now();
  const godziny = (h: number) => new Date(teraz + h * 60 * 60 * 1000);
  const ospId = organizacje['Ochotnicza Straż Pożarna Nowa Dęba'].id;

  const alerty: Array<{
    title: string;
    description: string;
    severity: Severity;
    status: AlertStatus;
    location: string;
    latitude: number;
    longitude: number;
    gminaId: string;
    authorId: string | null;
    // Mirrors the real backfill rule (organizationId = author's organizationId):
    // alerts "written by" the site-wide admin have no organization, and only
    // the ones authored by an org-affiliated user (here: the OSP koordynator)
    // get one — so ownership-based features have at least some seed data to
    // exercise against.
    organizationId: string | null;
    expiresAt: Date;
  }> = [
    { title: 'Podtopienia posesji przy ul. Rzecznej', description: 'Potok Dębianka wystąpił z koryta po nawalnych opadach deszczu, woda wdarła się na teren kilku posesji prywatnych.', severity: 'CRITICAL', status: 'ACTIVE', location: 'ul. Rzeczna', latitude: 50.4190, longitude: 21.7530, gminaId: gminy[0].id, authorId: koordynatorId, organizationId: koordynatorId ? ospId : null, expiresAt: godziny(48) },
    { title: 'Awaria sieci wodociągowej – os. Poligon', description: 'Przerwa w dostawie wody pitnej, trwa naprawa magistrali wodociągowej.', severity: 'MEDIUM', status: 'IN_PROGRESS', location: 'os. Poligon', latitude: 50.4130, longitude: 21.7450, gminaId: gminy[0].id, authorId: adminId, organizationId: null, expiresAt: godziny(20) },
    { title: 'Zerwany dach hali sportowej', description: 'Silny wiatr uszkodził pokrycie dachowe, teren zabezpieczony przez straż pożarną.', severity: 'HIGH', status: 'ACTIVE', location: 'ul. Sportowa 3', latitude: 50.4205, longitude: 21.7465, gminaId: gminy[0].id, authorId: koordynatorId, organizationId: koordynatorId ? ospId : null, expiresAt: godziny(24) },
    { title: 'Pożar poszycia leśnego na obrzeżach Poligonu OSPWL', description: 'Pożar traw i poszycia leśnego, jednostki straży pożarnej prowadzą działania gaśnicze na miejscu.', severity: 'CRITICAL', status: 'ACTIVE', location: 'Poligon OSPWL Nowa Dęba', latitude: 50.3980, longitude: 21.7180, gminaId: gminy[0].id, authorId: koordynatorId, organizationId: koordynatorId ? ospId : null, expiresAt: godziny(12) },
    { title: 'Uszkodzona linia energetyczna – Osiedle Zachodnie', description: 'Zerwana linia napowietrzna po silnym wietrze, wstrzymane dostawy prądu w części gminy.', severity: 'HIGH', status: 'IN_PROGRESS', location: 'Osiedle Zachodnie', latitude: 50.4225, longitude: 21.7395, gminaId: gminy[0].id, authorId: adminId, organizationId: null, expiresAt: godziny(16) },
    { title: 'Zwalone drzewo na drodze powiatowej', description: 'Droga częściowo zablokowana, utrudniony przejazd w kierunku Rozalina.', severity: 'LOW', status: 'RESOLVED', location: 'Droga powiatowa Rozalin-Jadachy', latitude: 50.4260, longitude: 21.7610, gminaId: gminy[0].id, authorId: adminId, organizationId: null, expiresAt: godziny(-2) },
    { title: 'Ostrzeżenie IMGW – silny wiatr', description: 'Ostrzeżenie 2. stopnia przed silnym wiatrem do jutra rana, możliwe dalsze uszkodzenia dachów i linii energetycznych.', severity: 'MEDIUM', status: 'ACTIVE', location: 'cała gmina', latitude: 50.4166, longitude: 21.7500, gminaId: gminy[0].id, authorId: adminId, organizationId: null, expiresAt: godziny(18) },
    { title: 'Ćwiczenia ewakuacyjne szkoły podstawowej', description: 'Planowe ćwiczenia służb ratowniczych, brak realnego zagrożenia.', severity: 'LOW', status: 'CANCELLED', location: 'Szkoła Podstawowa nr 1', latitude: 50.4145, longitude: 21.7545, gminaId: gminy[0].id, authorId: adminId, organizationId: null, expiresAt: godziny(-24) },
    { title: 'Osunięcie skarpy przy drodze wojewódzkiej', description: 'Częściowe osunięcie skarpy, droga zwężona do jednego pasa ruchu.', severity: 'MEDIUM', status: 'IN_PROGRESS', location: 'Droga wojewódzka 985', latitude: 50.4090, longitude: 21.7620, gminaId: gminy[0].id, authorId: adminId, organizationId: null, expiresAt: godziny(36) },
  ];

  await prisma.alert.deleteMany({ where: { gminaId: { in: gminy.map((g) => g.id) } } });
  await prisma.alert.createMany({ data: alerty });
}

// Projekt jest pilotażem dla jednej gminy (Nowa Dęba) — usuwa wszelkie inne
// gminy pozostałe z wcześniejszych wersji seeda (wraz z ich alertami,
// zasobami, zaproszeniami i użytkownikami), żeby baza nie zbierała
// "osieroconych" testowych danych z gmin spoza aktualnego zakresu projektu.
async function cleanupObsoleteGminy(currentGminaIds: string[]) {
  const obsolete = await prisma.gmina.findMany({ where: { id: { notIn: currentGminaIds } } });
  if (obsolete.length === 0) return;

  const obsoleteIds = obsolete.map((g) => g.id);
  await prisma.alert.deleteMany({ where: { gminaId: { in: obsoleteIds } } });
  await prisma.resource.deleteMany({ where: { gminaId: { in: obsoleteIds } } });
  await prisma.inviteToken.deleteMany({ where: { gminaId: { in: obsoleteIds } } });
  await prisma.user.deleteMany({ where: { gminaId: { in: obsoleteIds } } });
  await prisma.organization.deleteMany({ where: { gminaId: { in: obsoleteIds } } });
  await prisma.gmina.deleteMany({ where: { id: { in: obsoleteIds } } });

  console.log(`🧹 Usunięto nieaktualne gminy: ${obsolete.map((g) => g.name).join(', ')}`);
}

async function main() {
  await seedAdmin();

  if (process.env.NODE_ENV === 'production') {
    console.log('ℹ️  Pomijam dane testowe (gminy/użytkownicy/zasoby/alerty) w środowisku produkcyjnym.');
    return;
  }

  const admin = process.env.ADMIN_EMAIL
    ? await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL } })
    : null;

  const gminy = await seedGminy();
  const kategorie = await seedKategorie();
  const organizacje = await seedOrganizacje(gminy);
  await seedTestUsers(gminy, organizacje);
  const koordynator = await prisma.user.findUnique({ where: { email: 'koordynator@example.com' } });
  await seedZasoby(gminy, kategorie, organizacje);
  await seedAlerty(gminy, admin?.id ?? null, koordynator?.id ?? null, organizacje);
  await cleanupObsoleteGminy(gminy.map((g) => g.id));

  console.log('🌱 Dane testowe (gminy, kategorie, zasoby, alerty) gotowe.');
}

main()
  .catch((e) => {
    console.error('❌ Błąd podczas seedowania bazy:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
