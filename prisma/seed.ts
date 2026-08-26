import { PrismaClient, Role, Severity, AlertStatus, ResourceStatus } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

const TEST_PASSWORD = 'Test1234!';

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('ℹ️  Pomijam tworzenie konta admina: ustaw ADMIN_EMAIL i ADMIN_PASSWORD, aby je utworzyć.');
    return;
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
      emailVerified: new Date(),
    },
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

async function seedTestUsers(gminy: Awaited<ReturnType<typeof seedGminy>>) {
  const users: Array<{ email: string; name: string; role: Role; gminaId: string | null }> = [
    { email: 'koordynator@example.com', name: 'Katarzyna Nowak', role: 'COORDINATOR', gminaId: gminy[0].id },
    { email: 'wolontariusz@example.com', name: 'Anna Wiśniewska', role: 'VOLUNTEER', gminaId: gminy[1].id },
    { email: 'wolontariusz2@example.com', name: 'Marek Zieliński', role: 'VOLUNTEER', gminaId: gminy[2].id },
  ];

  const passwordHash = await hashPassword(TEST_PASSWORD);

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        gminaId: u.gminaId,
        passwordHash,
        isActive: true,
        emailVerified: new Date(),
      },
    });
  }

  console.log(`🌱 Konta testowe gotowe (hasło: ${TEST_PASSWORD}):`);
  users.forEach((u) => console.log(`   - ${u.email} [${u.role}]`));
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
  await seedTestUsers(gminy);
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
