import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seed script gotowy do użycia...');
}

main()
  .catch((e) => {
    console.error('❌ Błąd podczas seedowania bazy:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
