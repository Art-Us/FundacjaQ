import { PrismaClient, Role, Severity, AlertStatus, ResourceStatus } from '@prisma/client';
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
    { name: 'Gmina Wieliczka', powiat: 'wielicki', voivodeship: 'małopolskie', contactEmail: 'kryzys@wieliczka.pl' },
    { name: 'Gmina Sanok', powiat: 'sanocki', voivodeship: 'podkarpackie', contactEmail: 'kryzys@sanok.pl' },
    { name: 'Gmina Kłodzko', powiat: 'kłodzki', voivodeship: 'dolnośląskie', contactEmail: 'kryzys@klodzko.pl' },
  ];

  const created = [];
  for (const g of gminy) {
    created.push(await prisma.gmina.upsert({ where: { name: g.name }, update: {}, create: g }));
  }
  return created;
}

async function seedKategorie() {
  const kategorie = [
    { name: 'Żywność', icon: '🍞' },
    { name: 'Woda pitna', icon: '💧' },
    { name: 'Koce i odzież', icon: '🧣' },
    { name: 'Sprzęt medyczny', icon: '🩹' },
    { name: 'Agregaty prądotwórcze', icon: '🔌' },
  ];

  const created = [];
  for (const k of kategorie) {
    created.push(await prisma.resourceCategory.upsert({ where: { name: k.name }, update: {}, create: k }));
  }
  return created;
}

async function seedOrganizacje(gminy: Awaited<ReturnType<typeof seedGminy>>) {
  const organizacje: Array<{
    name: string;
    gminaId: string;
    street: string;
    houseNumber: string;
    apartmentNumber?: string;
    city: string;
    postalCode: string;
    contactFirstName: string;
    contactLastName: string;
    contactPhone: string;
    contactEmail: string;
  }> = [
    {
      name: 'Urząd Gminy Wieliczka',
      gminaId: gminy[0].id,
      street: 'Powstania Warszawskiego',
      houseNumber: '1',
      city: 'Wieliczka',
      postalCode: '32-020',
      contactFirstName: 'Katarzyna',
      contactLastName: 'Nowak',
      contactPhone: '+48 601 234 567',
      contactEmail: 'k.nowak@wieliczka.pl',
    },
    {
      name: 'Urząd Gminy Sanok',
      gminaId: gminy[1].id,
      street: 'Rynek',
      houseNumber: '1',
      city: 'Sanok',
      postalCode: '38-500',
      contactFirstName: 'Tomasz',
      contactLastName: 'Wójcik',
      contactPhone: '+48 605 111 222',
      contactEmail: 't.wojcik@sanok.pl',
    },
    {
      name: 'Polski Czerwony Krzyż',
      gminaId: gminy[1].id,
      street: 'Jana Pawła II',
      houseNumber: '5',
      city: 'Sanok',
      postalCode: '38-500',
      contactFirstName: 'Elżbieta',
      contactLastName: 'Kaczmarek',
      contactPhone: '+48 13 463 12 34',
      contactEmail: 'sanok@pck.org.pl',
    },
    {
      name: 'Ochotnicza Straż Pożarna Kłodzko',
      gminaId: gminy[2].id,
      street: 'Strażacka',
      houseNumber: '3',
      city: 'Kłodzko',
      postalCode: '57-300',
      contactFirstName: 'Grzegorz',
      contactLastName: 'Baran',
      contactPhone: '+48 74 867 45 12',
      contactEmail: 'osp@klodzko.pl',
    },
    {
      name: 'Caritas Diecezji Krakowskiej',
      gminaId: gminy[0].id,
      street: 'Krakowska',
      houseNumber: '8',
      apartmentNumber: '2',
      city: 'Wieliczka',
      postalCode: '32-020',
      contactFirstName: 'Magdalena',
      contactLastName: 'Sikora',
      contactPhone: '+48 12 429 56 78',
      contactEmail: 'wieliczka@caritas.pl',
    },
  ];

  const created: Record<string, { id: string }> = {};
  for (const o of organizacje) {
    const { name, gminaId, ...fields } = o;
    created[name] = await prisma.organization.upsert({
      where: { name_gminaId: { name, gminaId } },
      update: fields,
      create: { name, gminaId, ...fields },
    });
  }
  return created;
}

async function seedTestUsers(
  gminy: Awaited<ReturnType<typeof seedGminy>>,
  organizacje: Awaited<ReturnType<typeof seedOrganizacje>>
) {
  const users: Array<{
    email: string;
    name: string;
    role: Role;
    gminaId: string;
    organization: string;
    phone: string;
    isActive: boolean;
    lastActivatedAt: Date | null;
    lastDeactivatedAt: Date | null;
    deactivationReason: string | null;
  }> = [
    {
      email: 'koordynator@example.com',
      name: 'Katarzyna Nowak',
      role: 'COORDINATOR',
      gminaId: gminy[0].id,
      organization: 'Urząd Gminy Wieliczka',
      phone: '+48 601 234 567',
      isActive: true,
      lastActivatedAt: daysAgo(30),
      lastDeactivatedAt: null,
      deactivationReason: null,
    },
    {
      email: 'koordynator2@example.com',
      name: 'Tomasz Wójcik',
      role: 'COORDINATOR',
      gminaId: gminy[1].id,
      organization: 'Urząd Gminy Sanok',
      phone: '+48 605 111 222',
      isActive: true,
      lastActivatedAt: daysAgo(20),
      lastDeactivatedAt: null,
      deactivationReason: null,
    },
    {
      email: 'wolontariusz@example.com',
      name: 'Anna Wiśniewska',
      role: 'VOLUNTEER',
      gminaId: gminy[1].id,
      organization: 'Polski Czerwony Krzyż',
      phone: '+48 602 345 678',
      isActive: false,
      lastActivatedAt: daysAgo(60),
      lastDeactivatedAt: daysAgo(4),
      deactivationReason: 'Zakończony okres wolontariatu',
    },
    {
      email: 'wolontariusz2@example.com',
      name: 'Marek Zieliński',
      role: 'VOLUNTEER',
      gminaId: gminy[2].id,
      organization: 'Ochotnicza Straż Pożarna Kłodzko',
      phone: '+48 603 456 789',
      isActive: true,
      lastActivatedAt: daysAgo(15),
      lastDeactivatedAt: null,
      deactivationReason: null,
    },
    {
      email: 'wolontariusz3@example.com',
      name: 'Piotr Kowalski',
      role: 'VOLUNTEER',
      gminaId: gminy[0].id,
      organization: 'Caritas Diecezji Krakowskiej',
      phone: '+48 606 789 012',
      isActive: false,
      lastActivatedAt: null,
      lastDeactivatedAt: null,
      deactivationReason: null,
    },
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

async function seedZasoby(gminy: Awaited<ReturnType<typeof seedGminy>>, kategorie: Awaited<ReturnType<typeof seedKategorie>>) {
  const byName = (name: string) => kategorie.find((k) => k.name === name)!;

  const zasoby: Array<{
    name: string;
    description: string;
    quantity: number;
    unit: string;
    status: ResourceStatus;
    location: string;
    categoryId: string;
    gminaId: string;
  }> = [
    { name: 'Woda butelkowana 1.5L', description: 'Paletyzowana woda pitna', quantity: 4000, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn OSP Wieliczka', categoryId: byName('Woda pitna').id, gminaId: gminy[0].id },
    { name: 'Konserwy mięsne', description: 'Zapas żywności długoterminowej', quantity: 120, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn gminny', categoryId: byName('Żywność').id, gminaId: gminy[0].id },
    { name: 'Koce termiczne', description: 'Koce ratunkowe NRC', quantity: 15, unit: 'szt', status: 'RESERVED', location: 'Punkt ewakuacyjny nr 2', categoryId: byName('Koce i odzież').id, gminaId: gminy[0].id },
    { name: 'Agregat prądotwórczy 5kW', description: 'Do zasilania punktu koordynacji', quantity: 2, unit: 'szt', status: 'IN_USE', location: 'Sztab kryzysowy', categoryId: byName('Agregaty prądotwórcze').id, gminaId: gminy[0].id },
    { name: 'Zestawy pierwszej pomocy', description: 'Apteczki R1', quantity: 0, unit: 'szt', status: 'DEPLETED', location: 'Magazyn OSP Sanok', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[1].id },
    { name: 'Woda pitna w cysternach', description: '', quantity: 3, unit: 'm3', status: 'AVAILABLE', location: 'Baza transportowa', categoryId: byName('Woda pitna').id, gminaId: gminy[1].id },
    { name: 'Odzież zimowa', description: 'Kurtki i buty, różne rozmiary', quantity: 60, unit: 'szt', status: 'AVAILABLE', location: 'Magazyn Caritas', categoryId: byName('Koce i odzież').id, gminaId: gminy[1].id },
    { name: 'Żywność dla dzieci', description: 'Odżywki i słoiczki', quantity: 8, unit: 'kartony', status: 'RESERVED', location: 'Magazyn gminny', categoryId: byName('Żywność').id, gminaId: gminy[2].id },
    { name: 'Agregat prądotwórczy 2kW', description: 'Przenośny', quantity: 5, unit: 'szt', status: 'AVAILABLE', location: 'Remiza OSP Kłodzko', categoryId: byName('Agregaty prądotwórcze').id, gminaId: gminy[2].id },
    { name: 'Nosze ratownicze', description: '', quantity: 4, unit: 'szt', status: 'IN_USE', location: 'Punkt medyczny', categoryId: byName('Sprzęt medyczny').id, gminaId: gminy[2].id },
  ];

  await prisma.resource.deleteMany({ where: { gminaId: { in: gminy.map((g) => g.id) } } });
  await prisma.resource.createMany({ data: zasoby });
}

async function seedAlerty(gminy: Awaited<ReturnType<typeof seedGminy>>, adminId: string | null) {
  const teraz = Date.now();
  const godziny = (h: number) => new Date(teraz + h * 60 * 60 * 1000);

  const alerty: Array<{
    title: string;
    description: string;
    severity: Severity;
    status: AlertStatus;
    location: string;
    gminaId: string;
    authorId: string | null;
    expiresAt: Date;
  }> = [
    { title: 'Podtopienia w dolinie rzeki', description: 'Wzrost poziomu wody po intensywnych opadach, zagrożenie dla posesji przy ul. Nadrzecznej.', severity: 'CRITICAL', status: 'ACTIVE', location: 'ul. Nadrzeczna', gminaId: gminy[0].id, authorId: adminId, expiresAt: godziny(48) },
    { title: 'Uszkodzona linia energetyczna', description: 'Zerwana linia napowietrzna po silnym wietrze, wstrzymane dostawy prądu w części gminy.', severity: 'HIGH', status: 'IN_PROGRESS', location: 'Osiedle Zachodnie', gminaId: gminy[0].id, authorId: adminId, expiresAt: godziny(24) },
    { title: 'Zwalone drzewo na drodze gminnej', description: 'Droga częściowo zablokowana, utrudniony przejazd.', severity: 'LOW', status: 'RESOLVED', location: 'Droga gminna 12', gminaId: gminy[0].id, authorId: adminId, expiresAt: godziny(-2) },
    { title: 'Pożar zabudowań gospodarczych', description: 'Pożar stodoły, straż pożarna na miejscu, ryzyko rozprzestrzenienia na sąsiednie budynki.', severity: 'CRITICAL', status: 'ACTIVE', location: 'wieś Trepcza', gminaId: gminy[1].id, authorId: adminId, expiresAt: godziny(12) },
    { title: 'Braki w zaopatrzeniu w wodę', description: 'Awaria ujęcia wody, konieczna dystrybucja wody pitnej w cysternach.', severity: 'MEDIUM', status: 'ACTIVE', location: 'Centrum', gminaId: gminy[1].id, authorId: adminId, expiresAt: godziny(72) },
    { title: 'Osunięcie ziemi przy drodze wojewódzkiej', description: 'Częściowe osunięcie skarpy, droga zwężona do jednego pasa.', severity: 'MEDIUM', status: 'IN_PROGRESS', location: 'Droga wojewódzka 897', gminaId: gminy[2].id, authorId: adminId, expiresAt: godziny(36) },
    { title: 'Ćwiczenia ewakuacyjne', description: 'Planowe ćwiczenia służb ratowniczych, brak realnego zagrożenia.', severity: 'LOW', status: 'CANCELLED', location: 'Szkoła Podstawowa nr 1', gminaId: gminy[2].id, authorId: adminId, expiresAt: godziny(-24) },
    { title: 'Silny wiatr i ostrzeżenie IMGW', description: 'Ostrzeżenie 2. stopnia przed silnym wiatrem do jutra rana.', severity: 'HIGH', status: 'ACTIVE', location: 'cała gmina', gminaId: gminy[2].id, authorId: adminId, expiresAt: godziny(18) },
  ];

  await prisma.alert.deleteMany({ where: { gminaId: { in: gminy.map((g) => g.id) } } });
  await prisma.alert.createMany({ data: alerty });
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
  await seedZasoby(gminy, kategorie);
  await seedAlerty(gminy, admin?.id ?? null);

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
