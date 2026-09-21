import { PrismaClient, Role, Severity, AlertStatus, ResourceStatus, ResourceHorizon, AlertMessageType } from '@prisma/client';
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

// Kategorie ResourceCategory używane przy losowaniu 1-3 potrzeb (AlertNeed) na
// każdy alert — z ludzkimi tytułami/jednostkami dopasowanymi do kategorii,
// żeby "Zapotrzebowanie na zasoby" (R11) wyglądało realistycznie, a nie jak
// gołe nazwy kategorii.
const NEED_CATEGORY_NAMES = [
  'Woda pitna',
  'Żywność',
  'Koce i odzież',
  'Sprzęt medyczny',
  'Agregaty prądotwórcze',
  'Ludzie / Wolontariusze',
  'Środki czystości i higieny',
  'Materiały budowlane i naprawcze',
  'Sprzęt ratownictwa technicznego',
  'Zbiorniki i cysterny na wodę',
] as const;

const NEED_TITLE_BY_CATEGORY: Record<(typeof NEED_CATEGORY_NAMES)[number], string> = {
  'Woda pitna': 'Woda pitna dla poszkodowanych',
  Żywność: 'Paczki żywnościowe dla rodzin',
  'Koce i odzież': 'Koce i odzież na zimę',
  'Sprzęt medyczny': 'Zestawy pierwszej pomocy',
  'Agregaty prądotwórcze': 'Agregat prądotwórczy do zasilania',
  'Ludzie / Wolontariusze': 'Wolontariusze do pomocy na miejscu',
  'Środki czystości i higieny': 'Środki czystości i higieny osobistej',
  'Materiały budowlane i naprawcze': 'Materiały do zabezpieczenia budynków',
  'Sprzęt ratownictwa technicznego': 'Sprzęt do usuwania skutków zdarzenia',
  'Zbiorniki i cysterny na wodę': 'Cysterna z wodą pitną',
};

const NEED_UNIT_BY_CATEGORY: Record<(typeof NEED_CATEGORY_NAMES)[number], string> = {
  'Woda pitna': 'l',
  Żywność: 'porcje',
  'Koce i odzież': 'szt',
  'Sprzęt medyczny': 'szt',
  'Agregaty prądotwórcze': 'szt',
  'Ludzie / Wolontariusze': 'osób',
  'Środki czystości i higieny': 'zestawy',
  'Materiały budowlane i naprawcze': 'szt',
  'Sprzęt ratownictwa technicznego': 'szt',
  'Zbiorniki i cysterny na wodę': 'szt',
};

const NEED_URGENCIES = ['NORMAL', 'PILNE', 'KRYTYCZNY'] as const;

function needQuantity(categoryName: (typeof NEED_CATEGORY_NAMES)[number], i: number, k: number): number {
  const base = 1 + ((i * 3 + k * 11) % 20); // 1..20
  switch (categoryName) {
    case 'Woda pitna':
      return base * 25; // litry
    case 'Żywność':
      return base * 5; // porcje
    case 'Zbiorniki i cysterny na wodę':
      return 1 + (i % 3); // szt
    case 'Agregaty prądotwórcze':
      return 1 + (i % 4); // szt
    case 'Ludzie / Wolontariusze':
      return 2 + (base % 10); // osób
    default:
      return base; // szt
  }
}

// Deterministyczne, ale zróżnicowane wybieranie 1-3 kategorii na alert (bez
// powtórzeń w obrębie jednego alertu — długość NEED_CATEGORY_NAMES to 10, a
// offsety 0/7/4 są parami różne modulo 10 dla każdego i).
const NEED_CATEGORY_OFFSETS = [0, 7, 4];

const TOWN_CENTER = { lat: 50.4166, lng: 21.7500 };

// Rozprasza N punktów wokół centrum miasta spiralą Vogela (kąt złoty) —
// używane dla zdarzeń bez własnego, odrębnego sołectwa (ulice/obiekty w samej
// Nowej Dębie), które inaczej lądowałyby w jednym, ciasnym klastrze na mapie
// przy oddaleniu widoku na całą gminę (patrz zrzut ekranu użytkownika: pinezki
// nakładające się w centrum). Każdy kolejny indeks dostaje unikalny kąt i
// coraz większy promień, więc N punktów rozkłada się równo bez nakładania,
// bez uciekania się do (nie-deterministycznego) losowania.
function spreadAround(index: number, total: number, maxRadiusKm: number): { latitude: number; longitude: number } {
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const angle = index * GOLDEN_ANGLE;
  const radiusKm = maxRadiusKm * Math.sqrt((index + 0.5) / total);
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((TOWN_CENTER.lat * Math.PI) / 180);
  return {
    latitude: TOWN_CENTER.lat + (radiusKm * Math.cos(angle)) / kmPerDegLat,
    longitude: TOWN_CENTER.lng + (radiusKm * Math.sin(angle)) / kmPerDegLng,
  };
}

async function seedAlerty(
  gminy: Awaited<ReturnType<typeof seedGminy>>,
  kategorie: Awaited<ReturnType<typeof seedKategorie>>,
  koordynatorzy: Array<{ id: string; organizationId: string | null }>,
) {
  const teraz = Date.now();
  const godziny = (h: number) => new Date(teraz + h * 60 * 60 * 1000);
  const byName = (name: string) => kategorie.find((k) => k.name === name)!;

  // Do 30 alertów wokół Nowej Dęby i okolicznych sołectw — wszystkie zgłoszone
  // przez koordynatorów organizacji (nigdy przez admina), więc każdy ma
  // realną organizationId do wykorzystania przez authz/R1/R6/R11.
  const alerty: Array<{
    title: string;
    description: string;
    severity: Severity;
    status: AlertStatus;
    location: string;
    latitude: number;
    longitude: number;
    expiresAt: Date;
  }> = [
    { title: 'Podtopienia posesji przy ul. Rzecznej', description: 'Potok Dębianka wystąpił z koryta po nawalnych opadach deszczu, woda wdarła się na teren kilku posesji prywatnych.', severity: 'CRITICAL', status: 'ACTIVE', location: 'ul. Rzeczna', ...spreadAround(0, 19, 2.4), expiresAt: godziny(48) },
    { title: 'Awaria sieci wodociągowej – os. Poligon', description: 'Przerwa w dostawie wody pitnej, trwa naprawa magistrali wodociągowej.', severity: 'MEDIUM', status: 'IN_PROGRESS', location: 'os. Poligon', ...spreadAround(1, 19, 2.4), expiresAt: godziny(20) },
    { title: 'Zerwany dach hali sportowej', description: 'Silny wiatr uszkodził pokrycie dachowe, teren zabezpieczony przez straż pożarną.', severity: 'HIGH', status: 'ACTIVE', location: 'ul. Sportowa 3', ...spreadAround(2, 19, 2.4), expiresAt: godziny(24) },
    { title: 'Pożar poszycia leśnego na obrzeżach Poligonu OSPWL', description: 'Pożar traw i poszycia leśnego, jednostki straży pożarnej prowadzą działania gaśnicze na miejscu.', severity: 'CRITICAL', status: 'ACTIVE', location: 'Poligon OSPWL Nowa Dęba', latitude: 50.3980, longitude: 21.7180, expiresAt: godziny(12) },
    { title: 'Uszkodzona linia energetyczna – Osiedle Zachodnie', description: 'Zerwana linia napowietrzna po silnym wietrze, wstrzymane dostawy prądu w części gminy.', severity: 'HIGH', status: 'IN_PROGRESS', location: 'Osiedle Zachodnie', ...spreadAround(3, 19, 2.4), expiresAt: godziny(16) },
    { title: 'Zwalone drzewo na drodze powiatowej', description: 'Droga częściowo zablokowana, utrudniony przejazd w kierunku Rozalina.', severity: 'LOW', status: 'RESOLVED', location: 'Droga powiatowa Rozalin-Jadachy', latitude: 50.4260, longitude: 21.7610, expiresAt: godziny(-2) },
    { title: 'Ostrzeżenie IMGW – silny wiatr', description: 'Ostrzeżenie 2. stopnia przed silnym wiatrem do jutra rana, możliwe dalsze uszkodzenia dachów i linii energetycznych.', severity: 'MEDIUM', status: 'ACTIVE', location: 'cała gmina', latitude: 50.4166, longitude: 21.7500, expiresAt: godziny(18) },
    { title: 'Ćwiczenia ewakuacyjne szkoły podstawowej', description: 'Planowe ćwiczenia służb ratowniczych, brak realnego zagrożenia.', severity: 'LOW', status: 'CANCELLED', location: 'Szkoła Podstawowa nr 1', ...spreadAround(4, 19, 2.4), expiresAt: godziny(-24) },
    { title: 'Osunięcie skarpy przy drodze wojewódzkiej', description: 'Częściowe osunięcie skarpy, droga zwężona do jednego pasa ruchu.', severity: 'MEDIUM', status: 'IN_PROGRESS', location: 'Droga wojewódzka 985', latitude: 50.4090, longitude: 21.7620, expiresAt: godziny(36) },
    { title: 'Podtopienie gospodarstw rolnych – Cygany', description: 'Woda z okolicznych rowów melioracyjnych zalała pola i zabudowania gospodarcze w sołectwie Cygany.', severity: 'HIGH', status: 'ACTIVE', location: 'Sołectwo Cygany', latitude: 50.3860, longitude: 21.7460, expiresAt: godziny(30) },
    { title: 'Wylew rzeki Wisły – Chmielów', description: 'Wysoki stan wody spowodował zalanie terenów nadrzecznych w Chmielowie, ewakuowano kilka gospodarstw.', severity: 'CRITICAL', status: 'ACTIVE', location: 'Chmielów, ul. Nadwiślańska', latitude: 50.4510, longitude: 21.6890, expiresAt: godziny(60) },
    { title: 'Pożar stodoły – Alfredówka', description: 'Pożar zabudowań gospodarczych, ogień zagraża sąsiednim budynkom.', severity: 'HIGH', status: 'ACTIVE', location: 'Alfredówka', latitude: 50.4330, longitude: 21.7720, expiresAt: godziny(10) },
    { title: 'Awaria transformatora – Tarnowska Wola', description: 'Przerwa w dostawie prądu dla części miejscowości, trwa naprawa stacji transformatorowej.', severity: 'MEDIUM', status: 'IN_PROGRESS', location: 'Tarnowska Wola', latitude: 50.4680, longitude: 21.7010, expiresAt: godziny(14) },
    { title: 'Zerwany most na potoku – Poręby Dębskie', description: 'Wezbrana woda uszkodziła konstrukcję mostu, wstrzymano ruch pojazdów.', severity: 'HIGH', status: 'ACTIVE', location: 'Poręby Dębskie', latitude: 50.4400, longitude: 21.7900, expiresAt: godziny(40) },
    { title: 'Uszkodzona kamienica po nawałnicy – ul. Kościuszki', description: 'Silny wiatr zerwał część elewacji budynku wielorodzinnego, konieczne zabezpieczenie terenu.', severity: 'MEDIUM', status: 'ACTIVE', location: 'ul. Kościuszki', ...spreadAround(5, 19, 2.4), expiresAt: godziny(22) },
    { title: 'Zalanie piwnic po ulewie – Rynek', description: 'Intensywne opady spowodowały zalanie piwnic budynków przy Rynku.', severity: 'MEDIUM', status: 'ACTIVE', location: 'Rynek Nowa Dęba', ...spreadAround(6, 19, 2.4), expiresAt: godziny(15) },
    { title: 'Zerwana trakcja kolejowa – Dworzec PKP', description: 'Uszkodzenie sieci trakcyjnej wstrzymało ruch pociągów przez Nową Dębę.', severity: 'HIGH', status: 'IN_PROGRESS', location: 'Dworzec PKP Nowa Dęba', ...spreadAround(7, 19, 2.4), expiresAt: godziny(9) },
    { title: 'Pożar lasu komunalnego – Osiedle Podleśne', description: 'Pożar lasu w pobliżu zabudowań mieszkalnych, prowadzone działania gaśnicze z powietrza i ziemi.', severity: 'CRITICAL', status: 'ACTIVE', location: 'Osiedle Podleśne', ...spreadAround(8, 19, 2.4), expiresAt: godziny(8) },
    { title: 'Powalone drzewa blokujące dojazd – ul. Leśna', description: 'Kilka powalonych drzew blokuje jedyny dojazd do części osiedla.', severity: 'LOW', status: 'RESOLVED', location: 'ul. Leśna', ...spreadAround(9, 19, 2.4), expiresAt: godziny(-6) },
    { title: 'Awaria zapory ziemnej – Zalew w Chmielowie', description: 'Stwierdzono nieszczelność zapory, istnieje ryzyko zalania terenów poniżej zbiornika.', severity: 'CRITICAL', status: 'ACTIVE', location: 'Zalew w Chmielowie', latitude: 50.4560, longitude: 21.6840, expiresAt: godziny(50) },
    { title: 'Zalanie ulicy po awarii kanalizacji – ul. Kwiatowa', description: 'Awaria kolektora sanitarnego spowodowała zalanie jezdni i chodników.', severity: 'MEDIUM', status: 'ACTIVE', location: 'ul. Kwiatowa', ...spreadAround(10, 19, 2.4), expiresAt: godziny(13) },
    { title: 'Osunięcie ziemi po ulewnych deszczach – ul. Polna', description: 'Nasiąknięte zbocze osunęło się częściowo na jezdnię, droga zwężona.', severity: 'HIGH', status: 'ACTIVE', location: 'ul. Polna', ...spreadAround(11, 19, 2.4), expiresAt: godziny(28) },
    { title: 'Zwalone ogrodzenie i drzewa – cmentarz komunalny', description: 'Silny wiatr powalił część ogrodzenia i kilka drzew na terenie cmentarza.', severity: 'LOW', status: 'RESOLVED', location: 'Cmentarz komunalny', ...spreadAround(12, 19, 2.4), expiresAt: godziny(-10) },
    { title: 'Awaria ogrzewania w mroźną noc – Przedszkole nr 3', description: 'Awaria kotłowni pozostawiła placówkę bez ogrzewania, konieczne tymczasowe grzejniki.', severity: 'MEDIUM', status: 'ACTIVE', location: 'Przedszkole nr 3', ...spreadAround(13, 19, 2.4), expiresAt: godziny(19) },
    { title: 'Zalanie sali widowiskowej – Dom Kultury', description: 'Nieszczelny dach po ulewie spowodował zalanie sali i sprzętu nagłośnieniowego.', severity: 'LOW', status: 'IN_PROGRESS', location: 'Dom Kultury', ...spreadAround(14, 19, 2.4), expiresAt: godziny(11) },
    { title: 'Uszkodzone trybuny po wichurze – Stadion Miejski', description: 'Silny wiatr zerwał zadaszenie części trybun stadionu.', severity: 'MEDIUM', status: 'ACTIVE', location: 'Stadion Miejski', ...spreadAround(15, 19, 2.4), expiresAt: godziny(17) },
    { title: 'Pożar budynku wielorodzinnego – ul. Krótka', description: 'Pożar w jednym z mieszkań rozprzestrzenił się na klatkę schodową, trwa ewakuacja mieszkańców.', severity: 'CRITICAL', status: 'ACTIVE', location: 'ul. Krótka', ...spreadAround(16, 19, 2.4), expiresAt: godziny(6) },
    { title: 'Zerwana sieć telekomunikacyjna – ul. Wschodnia', description: 'Uszkodzenie linii światłowodowej pozbawiło część mieszkańców łączności internetowej.', severity: 'LOW', status: 'CANCELLED', location: 'ul. Wschodnia', ...spreadAround(17, 19, 2.4), expiresAt: godziny(-16) },
    { title: 'Skażenie ujęcia wody pitnej – Osiedle Poligon II', description: 'Podejrzenie zanieczyszczenia lokalnego ujęcia wody, do odwołania obowiązuje zakaz picia wody z kranu.', severity: 'CRITICAL', status: 'ACTIVE', location: 'Osiedle Poligon II', ...spreadAround(18, 19, 2.4), expiresAt: godziny(44) },
    { title: 'Podtopienie dróg dojazdowych – Jadachy', description: 'Wezbrane rowy przydrożne zalały odcinki dróg gminnych, utrudniony dojazd do sołectwa.', severity: 'HIGH', status: 'ACTIVE', location: 'Jadachy', latitude: 50.4340, longitude: 21.7650, expiresAt: godziny(26) },
    { title: 'Zerwana linia energetyczna po burzy – Rozalin', description: 'Upadłe drzewo zerwało linię energetyczną, kilkanaście gospodarstw w sołectwie zostało bez prądu.', severity: 'MEDIUM', status: 'ACTIVE', location: 'Rozalin', latitude: 50.4400, longitude: 21.7550, expiresAt: godziny(20) },
  ];

  await prisma.alert.deleteMany({ where: { gminaId: { in: gminy.map((g) => g.id) } } });

  const created: Awaited<ReturnType<typeof prisma.alert.create>>[] = [];

  for (let i = 0; i < alerty.length; i++) {
    const a = alerty[i];
    const koordynator = koordynatorzy[i % koordynatorzy.length];

    const alert = await prisma.alert.create({
      data: {
        title: a.title,
        description: a.description,
        severity: a.severity,
        status: a.status,
        location: a.location,
        latitude: a.latitude,
        longitude: a.longitude,
        gminaId: gminy[0].id,
        authorId: koordynator.id,
        organizationId: koordynator.organizationId,
        expiresAt: a.expiresAt,
      },
    });
    created.push(alert);

    // Każdy alert dostaje 1-3 potrzeby (R11) w różnych kategoriach — wybór
    // deterministyczny (patrz NEED_CATEGORY_OFFSETS), żeby ponowne odpalenie
    // seeda dawało tę samą, ale wciąż zróżnicowaną macierz potrzeb.
    const needCount = (i % 3) + 1;
    await prisma.alertNeed.createMany({
      data: Array.from({ length: needCount }, (_, k) => {
        const categoryName = NEED_CATEGORY_NAMES[(i + NEED_CATEGORY_OFFSETS[k]) % NEED_CATEGORY_NAMES.length];
        const category = byName(categoryName);
        return {
          alertId: alert.id,
          categoryId: category.id,
          title: NEED_TITLE_BY_CATEGORY[categoryName],
          quantityNeeded: needQuantity(categoryName, i, k),
          unit: NEED_UNIT_BY_CATEGORY[categoryName],
          urgency: NEED_URGENCIES[(i + k) % NEED_URGENCIES.length],
          createdById: koordynator.id,
        };
      }),
    });
  }

  return created;
}

// Krótkie szablony wpisów dziennika operacyjnego (Фаза 8, Крок 56) — jeden na
// każdy AlertMessageType, z treścią osadzoną w konkretnym alercie (tytuł/
// lokalizacja) i 1-3 gotowymi odpowiedziami w wątku pod nim. Celowo tylko
// kilka szablonów zapętlonych na małej podpróbce alertów (patrz
// seedAlertMessages) — użytkownik prosił, żeby wiadomości "nie było dużo".
const JOURNAL_TEMPLATES: Array<{
  type: AlertMessageType;
  title: string;
  body: (a: { title: string; location: string | null }) => string;
  replies: string[];
}> = [
  {
    type: 'SITUATION_UPDATE',
    title: 'Aktualizacja sytuacji na miejscu',
    body: (a) => `Służby dotarły na miejsce (${a.location ?? 'lokalizacja zdarzenia'}). Sytuacja pod kontrolą, monitorujemy dalszy rozwój.`,
    replies: [
      'Dziękujemy za informację, jesteśmy w gotowości do wsparcia.',
      'Czy potrzebne jest dodatkowe wsparcie logistyczne?',
    ],
  },
  {
    type: 'LOGISTICS_TRANSPORT',
    title: 'Organizacja transportu i zasobów',
    body: (a) => `Uzgadniamy transport niezbędnych zasobów na miejsce zdarzenia "${a.title}". Prosimy o kontakt organizacje mogące pomóc.`,
    replies: [
      'Możemy podjechać z transportem w ciągu 2 godzin.',
      'Zgłaszamy się do pomocy — mamy wolny sprzęt.',
      'Potwierdzamy odbiór zgłoszenia, jedziemy na miejsce.',
    ],
  },
  {
    type: 'STAFF_COMMUNIQUE',
    title: 'Komunikat sztabu kryzysowego',
    body: (a) => `Sztab kryzysowy informuje o statusie zdarzenia "${a.title}". Prosimy o zachowanie ostrożności w okolicy.`,
    replies: ['Przyjęto do wiadomości.'],
  },
  {
    type: 'UNIT_SUPPORT',
    title: 'Wsparcie jednostek na miejscu',
    body: (a) => `Potrzebne dodatkowe jednostki do wsparcia działań w rejonie: ${a.location ?? 'zgłoszenia'}.`,
    replies: ['Wysyłamy dodatkową jednostkę.', 'Jesteśmy w drodze, ETA 20 minut.'],
  },
];

// Indeksy alertów (w tablicy `alerty` z seedAlerty, w kolejności tworzenia),
// które dostają wątek dziennika/forum — rozstrzelone po różnych statusach,
// krytyczności i organizacjach, ale tylko 8 z ~30, żeby danych demo nie było
// za dużo (Фаза 8, Крок 56/61).
const JOURNAL_ALERT_INDICES = [0, 3, 6, 9, 13, 17, 22, 27];

async function seedAlertMessages(
  alerts: Array<{ id: string; title: string; location: string | null; organizationId: string | null }>,
  koordynatorzy: Array<{ id: string; organizationId: string | null }>,
) {
  await prisma.alertMessage.deleteMany({ where: { alertId: { in: alerts.map((a) => a.id) } } });

  for (let j = 0; j < JOURNAL_ALERT_INDICES.length; j++) {
    const alert = alerts[JOURNAL_ALERT_INDICES[j]];
    if (!alert) continue;

    const template = JOURNAL_TEMPLATES[j % JOURNAL_TEMPLATES.length];
    // Tworzenie wpisu głównego ("wpis") nie jest przypisane do organizacji
    // właściciela alertu — canPostAlertJournalEntry sprawdza tylko rolę
    // (ADMIN/COORDINATOR), patrz src/lib/resourceAuthz.ts.
    const rootAuthor = koordynatorzy[j % koordynatorzy.length];

    const root = await prisma.alertMessage.create({
      data: {
        alertId: alert.id,
        type: template.type,
        title: template.title,
        body: template.body(alert),
        authorId: rootAuthor.id,
        authorOrgId: rootAuthor.organizationId,
      },
    });

    // Odpowiedzi w wątku — mieszanka koordynatora organizacji-właściciela
    // alertu (zawsze może odpowiedzieć, canReplyToAlertForum) i innych
    // rotujących koordynatorów (ADMIN/COORDINATOR mogą odpowiadać wszędzie).
    const ownerCoordinator = koordynatorzy.find((k) => k.organizationId === alert.organizationId) ?? rootAuthor;
    const replyAuthors = [
      ownerCoordinator,
      koordynatorzy[(j + 1) % koordynatorzy.length],
      koordynatorzy[(j + 3) % koordynatorzy.length],
    ];

    for (let r = 0; r < template.replies.length; r++) {
      const author = replyAuthors[r % replyAuthors.length];
      await prisma.alertMessage.create({
        data: {
          alertId: alert.id,
          parentId: root.id,
          body: template.replies[r],
          authorId: author.id,
          authorOrgId: author.organizationId,
        },
      });
    }
  }
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

  const gminy = await seedGminy();
  const kategorie = await seedKategorie();
  const organizacje = await seedOrganizacje(gminy);
  await seedTestUsers(gminy, organizacje);
  // Wszystkie 8 organizacji z własnym koordynatorem (patrz seedTestUsers) —
  // nowe alerty (seedAlerty) rotują przez nich jako autorów, nigdy przez
  // admina, żeby każdy alert miał realną organizationId (R6).
  const koordynatorEmaile = [
    'koordynator@example.com',
    'koordynator2@example.com',
    'koordynator3@example.com',
    'koordynator4@example.com',
    'koordynator5@example.com',
    'koordynator6@example.com',
    'koordynator7@example.com',
    'koordynator8@example.com',
  ];
  const koordynatorzy = await Promise.all(
    koordynatorEmaile.map((email) => prisma.user.findUniqueOrThrow({ where: { email } }))
  );
  await seedZasoby(gminy, kategorie, organizacje);
  const createdAlerts = await seedAlerty(gminy, kategorie, koordynatorzy);
  await seedAlertMessages(createdAlerts, koordynatorzy);
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
