import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

async function main() {
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

main()
  .catch((e) => {
    console.error('❌ Błąd podczas seedowania bazy:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
